package TokateDesktop

import System
import System.Collections.Generic

/// The donor's saved runs. Runs are found on disk, read a page at a time by four background readers, and
/// cached. A run can be selected to continue, submit, verify again or amend.
class SavedWorkService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let dialogs DialogService
    private let window WindowService
    private let changed Action
    private let cache Dictionary[string, SavedRun] = Dictionary[string, SavedRun]()
    private var readers []RunReader = []RunReader{}
    /// Increases whenever reading stops, so results from an earlier page or discovery are ignored.
    private var revision int32
    /// Continues a reserved run as a donation.
    var OnWork Action[Run, string]?
    var Current SavedWorkState = SavedWorkState.Initial

    init(
        commands CommandRunner,
        activity ActivityService,
        feedback FeedbackService,
        dialogs DialogService,
        window WindowService,
        changed Action
    ) {
        this.commands = commands
        this.activity = activity
        this.feedback = feedback
        this.dialogs = dialogs
        this.window = window
        this.changed = changed
    }

    private func Set(next SavedWorkState) {
        Current = next
        changed()
    }

    /// Remembers the run a command just created or used, so it is listed first and opened by default.
    func Remember(path string) {
        StopUpdates()
        Set(Current with{RunPath = path})
    }

    func SetRunPath(path string) -> Set(Current with{RunPath = path})

    func ToggleImport() -> Set(Current with{Importing = !Current.Importing})

    /// Called when the page opens: finds runs the first time, otherwise refreshes the visible page.
    func Enter() {
        if activity.Busy {
            return
        }
        if !Current.Loaded && Current.RunPath == "" {
            Discover()
        } else if Current.Loaded && !Current.Selected {
            LoadPage(Current.Page)
        }
    }

    /// Stops reading, or finds every saved run again.
    func ToggleReading() {
        if Current.Reading {
            StopUpdates()
            changed()
        } else {
            Discover()
        }
    }

    func StopUpdates() {
        revision++
        for reader in readers {
            reader.Stop()
        }
        readers = []RunReader{}
        Current = Current with{Reading = false}
    }

    /// Lists run directories in the background, then reads the current page.
    func Discover() {
        StopUpdates()
        cache.Clear()
        Set(Current with{Loaded = true, Reading = true, Paths = []string{}, Rows = []SavedRun{}})
        go FindRuns(Current.RunPath, revision)
    }

    private func FindRuns(remembered string, expected int32) {
        var paths = []string{}
        var error = ""
        try {
            paths = RunStore.Discover(remembered)
        } catch (failure Exception) {
            error = failure.Message
        }
        window.Post(() -> Found(paths, error, expected))
    }

    private func Found(paths []string, error string, expected int32) {
        if expected != revision {
            return
        }
        Set(Current with{Paths = paths, Reading = false})
        if error != "" {
            feedback.Show(error)
            return
        }
        LoadPage(Current.Page)
    }

    /// Shows `page` from the cache and reads the runs on it that have not been read yet.
    func LoadPage(page int32) {
        StopUpdates()
        let current = Math.Clamp(page, 1, Current.LastPage)
        let rows = List[SavedRun]()
        let start = (current - 1) * IssueListing.PageSize
        for index in start ... Math.Min(Current.Paths.Length, start + IssueListing.PageSize) {
            let path = Current.Paths[index]
            rows.Add(cache.TryGetValue(path, out var cached) ? cached: SavedRun.Pending(path))
        }
        Set(Current with{Page = current, Selected = false, Rows = rows.ToArray()})
        Read(rows.ToArray())
    }

    private func Read(items []SavedRun) {
        let pending = List[SavedRun]()
        for item in items {
            if !item.Refreshed {
                pending.Add(item)
            }
        }
        if pending.Count == 0 {
            return
        }
        let count = Math.Min(4, pending.Count)
        let pool = List[RunReader]()
        for i in 0 ... count {
            pool.Add(RunReader())
        }
        readers = pool.ToArray()
        Set(Current with{Reading = true})
        go ReadRuns(readers, pending.ToArray(), revision)
    }

    /// Splits `sources` across the readers, which read their share in order.
    private func ReadRuns(pool []RunReader, sources []SavedRun, expected int32) {
        scope {
            for index in 0 ... pool.Length {
                let batch = List[SavedRun]()
                for item in 0 ... sources.Length {
                    if item % pool.Length == index {
                        batch.Add(sources[item])
                    }
                }
                go ReadBatch(pool[index], batch.ToArray(), expected)
            }
        }
        window.Post(() -> Finished(expected))
    }

    private func ReadBatch(reader RunReader, batch []SavedRun, expected int32) {
        for source in batch {
            if !reader.Read(source, item -> window.Post(() -> Received(item, expected))) {
                return
            }
        }
    }

    private func Received(item SavedRun, expected int32) {
        if expected != revision {
            return
        }
        cache[item.Path] = item
        let rows = List[SavedRun](Current.Rows)
        for index in 0 ... rows.Count {
            if rows[index].Path == item.Path {
                rows[index] = item
            }
        }
        Set(Current with{Rows = rows.ToArray()})
    }

    private func Finished(expected int32) {
        if expected == revision {
            readers = []RunReader{}
            Set(Current with{Reading = false})
        }
    }

    // Selected run

    func Select(item SavedRun) {
        guard let run = item.Run else {
            return
        }
        StopUpdates()
        Set(
            Current with{
                Selected = true,
                Run = run,
                RunPath = item.Path,
                Actions = RunActions.From(item.Actions, run.State),
                Amendment = Current.Amendment with{Open = false},
            }
        )
    }

    func Back() -> LoadPage(Current.Page)

    /// Reads the run at `RunPath` and selects it.
    func LoadRun() {
        let path = Current.RunPath
        if String.IsNullOrWhiteSpace(path) {
            return
        }
        StopUpdates()
        commands.Cli[Run](
            TokateCommands.Status(path),
            RunCodec.Reader(path),
            (reply Reply[Run]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                let item = SavedRun.Pending(path) with{
                    Run = reply.Value,
                    Actions = reply.Outcome.Envelope?.NextActions ?? []NextAction{},
                }
                cache[path] = item
                if Array.IndexOf(Current.Paths, path) < 0 {
                    let paths = List[string](Current.Paths)
                    paths.Add(path)
                    Current = Current with{Paths = paths.ToArray()}
                }
                Select(item)
                Set(Current with{Loaded = true, Importing = false})
                Read([]SavedRun{item})
            }
        )
    }

    /// Runs `action` on the selected run after confirmation. Work continues on the donate page.
    func Act(action RunAction) {
        let run = Current.Run
        let path = Current.RunPath
        if action == RunAction.Work {
            OnWork?.Invoke(run, path)
            return
        }
        try {
            let amendment = Current.Amendment
            let arguments = TokateCommands.RunAction(action, path, amendment)
            if action == RunAction.Amend {
                for file in []string{amendment.Summary, amendment.Tools} {
                    if file != "" && !RunStore.Exists(file) {
                        throw Exception("Selected amendment file does not exist.")
                    }
                }
            }
            let seconds = TokateCommands.RunActionTimeout(action, amendment)
            dialogs.Ask(
                Confirmation{
                    Title: RunActions.DialogTitle(action),
                    Text: run.Identity + "\n\n" + RunActions.DialogDetail(action),
                    ConfirmLabel: "Confirm",
                    Heading: "",
                },
                () -> {
                    commands.Cli(
                        arguments,
                        (outcome CommandOutcome) -> {
                            if !commands.Failed(outcome) {
                                LoadRun()
                            }
                        },
                        seconds: seconds
                    )
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message)
        }
    }

    // Amendment

    func ToggleAmendment() -> SetAmendment(Current.Amendment with{Open = !Current.Amendment.Open})

    func SetVerification(minutes string) -> SetAmendment(Current.Amendment with{Verification = minutes})

    func SetCommit(commit string) -> SetAmendment(Current.Amendment with{Commit = commit})

    func SetSummary(path string) -> SetAmendment(Current.Amendment with{Summary = path})

    func SetTools(path string) -> SetAmendment(Current.Amendment with{Tools = path})

    private func SetAmendment(amendment AmendmentDraft) -> Set(Current with{Amendment = amendment})
}
