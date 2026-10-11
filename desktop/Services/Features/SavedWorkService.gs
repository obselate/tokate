package TokateDesktop

import System
import System.Collections.Generic

/// The donor's saved runs. Runs are found on disk and cached. The runs of a page are read at the same time
/// and shown together. A run can be selected to continue, submit, verify again or amend.
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

    /// Lists run directories in the background, then reads the current page. The rows in view stay until then.
    func Discover() {
        StopUpdates()
        cache.Clear()
        Set(Current with{Loaded = true, Reading = true})
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
            feedback.Show(error, Tone.Fail)
            return
        }
        LoadPage(Current.Page)
    }

    /// Shows `page` when all its runs are read. Otherwise the rows in view stay while the page is read.
    func LoadPage(page int32) {
        StopUpdates()
        let current = Math.Clamp(page, 1, Current.LastPage)
        let pending = List[SavedRun]()
        for path in PagePaths(current) {
            if !cache.ContainsKey(path) {
                pending.Add(SavedRun.Pending(path) with{Changed = RunStore.Changed(path)})
            }
        }
        Set(Current with{Page = current, Selected = false, Rows = pending.Count == 0 ? Cached(current): Current.Rows})
        Read(pending.ToArray())
    }

    private func PagePaths(page int32) ArraySegment[string] {
        let start = Math.Min(Current.Paths.Length, (page - 1) * IssueListing.PageSize)
        return ArraySegment[string](Current.Paths, start, Math.Min(IssueListing.PageSize, Current.Paths.Length - start))
    }

    private func Cached(page int32) []SavedRun {
        let rows = List[SavedRun]()
        for path in PagePaths(page) {
            if cache.TryGetValue(path, out var item) {
                rows.Add(item)
            }
        }
        return rows.ToArray()
    }

    /// Reads the items that are not refreshed, each with its own reader, at the same time.
    private func Read(items []SavedRun) {
        let pending = List[SavedRun]()
        let pool = List[RunReader]()
        for item in items {
            if !item.Refreshed {
                pending.Add(item)
                pool.Add(RunReader())
            }
        }
        if pending.Count == 0 {
            return
        }
        readers = pool.ToArray()
        Set(Current with{Reading = true})
        go ReadRuns(readers, pending.ToArray(), revision)
    }

    private func ReadRuns(pool []RunReader, sources []SavedRun, expected int32) {
        scope {
            for index in 0 ... pool.Length {
                go ReadRun(pool[index], sources[index], expected)
            }
        }
        window.Post(() -> Finished(expected))
    }

    private func ReadRun(reader RunReader, source SavedRun, expected int32) {
        if let item = reader.Read(source) {
            window.Post(() -> Received(item, expected))
        }
    }

    private func Received(item SavedRun, expected int32) {
        if expected != revision {
            return
        }
        cache[item.Path] = item
        if Current.Selected && item.Path == Current.RunPath {
            Set(Current with{Chosen = item})
        }
    }

    /// Shows the page in one update when all its runs are read.
    private func Finished(expected int32) {
        if expected == revision {
            readers = []RunReader{}
            Set(Current with{Reading = false, Rows = Current.Selected ? Current.Rows: Cached(Current.Page)})
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
                Chosen = item,
                Run = run,
                RunPath = item.Path,
                Actions = RunActions.From(item.Actions, run.State),
                Amendment = Current.Amendment with{Open = false},
            }
        )
        Read([]SavedRun{item})
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
                    Changed = RunStore.Changed(path),
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
            let arguments = TokateCommands.RunAction(action, path, amendment, run.Commit)
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
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    // Amendment

    /// Opens or closes the amendment form. Opening reads the correction in the saved checkout.
    func ToggleAmendment() {
        let opening = !Current.Amendment.Open
        SetAmendment(Current.Amendment with{Open = opening, Commit = "", Subject = ""})
        if opening {
            go ReadCorrection(Current.Run.Checkout, Current.Run.Commit, Current.RunPath)
        }
    }

    private func ReadCorrection(checkout string, published string, path string) {
        let head = RunStore.Correction(checkout, published)
        window.Post(
            () -> {
                if Current.RunPath == path && Current.Amendment.Open {
                    SetAmendment(Current.Amendment with{Commit = head.Commit, Subject = head.Subject})
                }
            }
        )
    }

    func SetVerification(minutes string) -> SetAmendment(Current.Amendment with{Verification = minutes})

    func SetSummary(path string) -> SetAmendment(Current.Amendment with{Summary = path})

    func SetTools(path string) -> SetAmendment(Current.Amendment with{Tools = path})

    private func SetAmendment(amendment AmendmentDraft) -> Set(Current with{Amendment = amendment})
}
