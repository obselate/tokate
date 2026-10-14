package TokateDesktop

import System
import System.Collections.Generic
import System.Text

/// The donor's saved runs. Runs are found on disk, read in the background by eight readers and cached. The
/// visible page is read first and shown in one update, so later pages show at once. A run can be selected to
/// continue, submit, check or amend.
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
    /// The request that the coordinator has, which is checked every minute.
    private var request CoordinatorRequest?
    private var requestTimer IDisposable?
    private var requestCheck CliClient?
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

    /// Shows `page` when all its runs are read. Otherwise the rows in view stay until then. Every run that is
    /// not read is read in the background, the runs of `page` first.
    func LoadPage(page int32) {
        StopUpdates()
        let current = Math.Clamp(page, 1, Current.LastPage)
        let order = List[string](PagePaths(current))
        order.AddRange(Current.Paths)
        let pending = List[SavedRun]()
        let queued = HashSet[string]()
        for path in order {
            if !cache.ContainsKey(path) && queued.Add(path) {
                pending.Add(SavedRun.Pending(path) with{Changed = RunStore.Changed(path)})
            }
        }
        let rows = Cached(current)
        Set(
            Current with{
                Page = current,
                Selected = false,
                Rows = rows.Length == PagePaths(current).Count ? rows: Current.Rows,
            }
        )
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

    /// Reads the items that are not refreshed, in order, with at most eight readers at the same time.
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
        let pool = List[RunReader]()
        for i in 0 ... Math.Min(8, pending.Count) {
            pool.Add(RunReader())
        }
        readers = pool.ToArray()
        Set(Current with{Reading = true})
        go ReadRuns(readers, pending.ToArray(), revision)
    }

    private func ReadRuns(pool []RunReader, sources []SavedRun, expected int32) {
        let queue = chan[SavedRun](sources.Length)
        for source in sources {
            queue <- source
        }
        queue.Close()
        scope {
            for reader in pool {
                go ReadQueue(reader, queue, expected)
            }
        }
        window.Post(() -> Finished(expected))
    }

    private func ReadQueue(reader RunReader, queue chan[SavedRun], expected int32) {
        for source in queue {
            guard let item = reader.Read(source) else {
                return
            }
            window.Post(() -> Received(item, expected))
        }
    }

    /// Keeps a read run. The run that completes the visible page shows that page in one update.
    private func Received(item SavedRun, expected int32) {
        if expected != revision {
            return
        }
        cache[item.Path] = item
        if Current.Selected {
            if item.Path == Current.RunPath {
                Set(Current with{Chosen = item})
            }
            return
        }
        let rows = Cached(Current.Page)
        if rows.Length == PagePaths(Current.Page).Count && Array.Exists(rows, row -> row.Path == item.Path) {
            Set(Current with{Rows = rows})
        }
    }

    private func Finished(expected int32) {
        if expected == revision {
            readers = []RunReader{}
            Set(Current with{Reading = false})
        }
    }

    func Select(item SavedRun) {
        guard let run = item.Run else {
            return
        }
        StopUpdates()
        let same = request?.Path == item.Path
        Set(
            Current with{
                Selected = true,
                Chosen = item,
                Run = run,
                RunPath = item.Path,
                Actions = RunActions.From(item.Actions, run.State),
                Amendment = Current.Amendment with{Open = false},
                Waiting = same,
                Note = same || item.Path == Current.RunPath ? Current.Note: Feedback{Message: "", Report: ""},
            }
        )
        Read([]SavedRun{item})
        if request == nil && run.Amending != "" {
            go Resume(run, item.Path)
        }
    }

    /// Continues the wait for an amendment that Tokate saved as requested, for example before the app closed.
    private func Resume(run Run, path string) {
        var found CoordinatorRequest? = nil
        try {
            found = RunStore.FinishAmendment(run, path)
        } catch (error Exception) {
        }
        window.Post(
            () -> {
                if let sent = found {
                    if request == nil && Current.Selected && Current.RunPath == path {
                        Await(sent)
                    } else {
                        Discard(sent.Files)
                    }
                }
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
                    Changed = RunStore.Changed(path),
                    Run = reply.Value with{Warning = reply.Outcome.Warning, Checkout = RunStore.Checkout(reply.Value)},
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
    func Follow(action NextAction) {
        let arguments = action.Arguments
        if arguments.Length < 2 || arguments[0] != "tokate" {
            return
        }
        dialogs.Ask(
            Confirmation{
                Title: "Follow the next step?",
                Text: Current.Run.Guidance == "" ? String.Join(" ", arguments): Current.Run.Guidance + "\n\n" + String.Join(" ", arguments),
                ConfirmLabel: "Run command",
                Heading: Current.Run.Identity,
            },
            () -> commands.Cli(
                Array.FindAll(ArraySegment[string](arguments, 1, arguments.Length - 1).ToArray(), argument -> argument != "--json"),
                (outcome CommandOutcome) -> {
                    if !commands.Failed(outcome) {
                        if action.Command == "help" || action.Command == "status" {
                            feedback.ShowReport(outcome.Report)
                            return
                        }
                        if outcome.RunPath != "" {
                            Set(Current with{RunPath = outcome.RunPath})
                        }
                        LoadRun()
                    }
                },
                seconds: 600
            )
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
            let seconds = TokateCommands.RunActionTimeout(action, amendment)
            var summary = ""
            var tools = ""
            if action == RunAction.Amend {
                summary = Json.Summary(amendment.ValidCommit(run.Commit), amendment.Summary.Valid())
                if Encoding.UTF8.GetByteCount(summary) > 4096 {
                    throw Exception("The summary is too long. Shorten or remove lines.")
                }
                if amendment.Edited == EditedBy.Donation {
                    tools = Json.Tools(run)
                } else if amendment.Edited == EditedBy.Other && !RunStore.Exists(amendment.Tools) {
                    throw Exception("Selected tool declarations file does not exist.")
                }
            }
            dialogs.Ask(
                Confirmation{
                    Title: RunActions.DialogTitle(action),
                    Text: run.Identity + "\n\n" + RunActions.DialogDetail(action),
                    ConfirmLabel: "Confirm",
                    Heading: "",
                },
                () -> {
                    StopWaiting("")
                    let files = summary == "" ? "": RunStore.WriteAmendment(summary, tools)
                    let arguments = TokateCommands.RunAction(action, path, amendment, run.Commit, files)
                    let since = DateTime.UtcNow
                    let started = commands.Cli(
                        arguments,
                        (outcome CommandOutcome) -> {
                            if outcome.Failure != "" || commands.Failed(outcome) {
                                Discard(files)
                                let reason = action == RunAction.Amend ? RunStore.AmendmentFailure(path, amendment.Commit, since): ""
                                if reason != "" {
                                    feedback.Show(reason, Tone.Fail)
                                }
                                return
                            }
                            if RunActions.Requests(action) {
                                Await(
                                    CoordinatorRequest{
                                        Action: action,
                                        Path: path,
                                        Repo: run.Repo,
                                        Issue: run.Issue,
                                        Head: action == RunAction.Amend ? amendment.Commit: run.Commit,
                                        Arguments: arguments,
                                        Seconds: seconds,
                                        Files: files,
                                        Since: since,
                                    }
                                )
                            } else {
                                Discard(files)
                            }
                            LoadRun()
                        },
                        seconds: seconds,
                        completeOnError: true
                    )
                    if !started {
                        Discard(files)
                    }
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    private func Discard(files string) {
        if files != "" {
            RunStore.Remove(files)
        }
    }

    /// Waits for the coordinator to record `sent`, then repeats its command, which saves the result.
    private func Await(sent CoordinatorRequest) {
        request = sent
        Set(Current with{Waiting = true, Note = Feedback{Message: RunActions.Requested(sent.Action), Report: "", Tone: Tone.Wait}})
        requestTimer = window.Every(60000, () -> CheckRequest())
        CheckRequest()
    }

    /// Stops the wait and shows `message`. The request stays with the coordinator.
    private func StopWaiting(message string, tone Tone = Tone.Need) {
        requestTimer?.Dispose()
        requestTimer = nil
        requestCheck = nil
        if let sent = request {
            Discard(sent.Files)
        }
        request = nil
        Set(Current with{Waiting = false, Note = Feedback{Message: message, Report: "", Tone: tone}})
    }

    private func CheckRequest() {
        guard let sent = request else {
            return
        }
        if !Current.Selected || Current.RunPath != sent.Path {
            StopWaiting("")
        } else if (DateTime.UtcNow - sent.Since).TotalMinutes > 10 {
            StopWaiting("The coordinator did not answer in 10 minutes. Do the action again later.")
        } else if !activity.Busy && requestCheck == nil {
            let client = CliClient()
            requestCheck = client
            go ReadRequest(client, sent)
        }
    }

    private func ReadRequest(client CliClient, sent CoordinatorRequest) {
        let reply = client.Run[string](TokateCommands.IssueStatus(sent.Repo, sent.Issue.ToString()), RunCodec.ContributionHead)
        let recorded = reply.Outcome.Succeeded && reply.Value == sent.Head
        window.Post(() -> RequestChecked(client, recorded))
    }

    private func RequestChecked(client CliClient, recorded bool) {
        if requestCheck != client {
            return
        }
        requestCheck = nil
        guard let sent = request else {
            return
        }
        if !recorded || activity.Busy {
            return
        }
        requestTimer?.Dispose()
        requestTimer = nil
        let started = commands.Cli(
            sent.Arguments,
            (outcome CommandOutcome) -> {
                let failed = outcome.Failure != "" || commands.Failed(outcome)
                StopWaiting(failed ? "": RunActions.Recorded(sent.Action), Tone.Done)
                if !failed {
                    LoadRun()
                }
            },
            seconds: sent.Seconds,
            completeOnError: true
        )
        if !started {
            requestTimer = window.Every(60000, () -> CheckRequest())
        }
    }

    /// Opens or closes the amendment form. Opening reads the public summary of the run, so the form
    /// starts with the lines that the pull request shows, and with manual editing as the declared tool.
    func ToggleAmendment() {
        let opening = !Current.Amendment.Open
        if opening && Current.Run.Pr == 0 && !Current.Run.External {
            let path = Current.RunPath
            commands.Cli(
                []string{"amend", "--run", path},
                (outcome CommandOutcome) -> {
                    if !commands.Failed(outcome) && Current.RunPath == path {
                        SetAmendment(Current.Amendment with{Open = true, Summary = PublicSummary.Empty, Edited = EditedBy.Hand})
                        feedback.Show("Original evidence preserved. Edit and commit the checkout, then select Check again.")
                        ReadCorrection(true)
                    }
                },
                seconds: 600
            )
        } else {
            SetAmendment(Current.Amendment with{Open = opening, Summary = PublicSummary.Empty, Edited = EditedBy.Hand})
            if opening {
                ReadCorrection(true)
            }
        }
    }

    /// Reads the correction in the saved checkout.
    func ReadCorrection(opening bool = false) {
        SetAmendment(Current.Amendment with{Checked = false, Commit = "", Subject = "", Files = 0})
        go LoadCorrection(Current.Run, Current.RunPath, opening)
    }

    private func LoadCorrection(run Run, path string, opening bool) {
        let head = RunStore.Correction(run.Checkout, run.Commit)
        let summary = opening ? RunStore.Summary(path, run.Commit): PublicSummary.Empty
        window.Post(
            () -> {
                if Current.RunPath == path && Current.Amendment.Open {
                    SetAmendment(
                        Current.Amendment with{
                            Checked = true,
                            Commit = head.Commit,
                            Subject = head.Subject,
                            Files = head.Files,
                            Summary = opening ? summary: Current.Amendment.Summary,
                        }
                    )
                }
            }
        )
    }

    func OpenCheckout() -> Browser.OpenFolder(Current.Run.Checkout)

    func SetVerification(minutes string) -> SetAmendment(Current.Amendment with{Verification = minutes})

    func SetSummary(summary PublicSummary) -> SetAmendment(Current.Amendment with{Summary = summary})

    func SetEdited(edited EditedBy) -> SetAmendment(Current.Amendment with{Edited = edited})

    func SetTools(path string) -> SetAmendment(Current.Amendment with{Tools = path})

    private func SetAmendment(amendment AmendmentDraft) -> Set(Current with{Amendment = amendment})
}
