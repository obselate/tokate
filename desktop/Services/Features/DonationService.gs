package TokateDesktop

import System
import System.Collections.Generic

/// The donor's flow: find an approved issue, choose a coding tool and limits, reserve the work, wait for
/// the coordinator's approval, then run it and follow its output.
class DonationService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let dialogs DialogService
    private let navigation NavigationService
    private let window WindowService
    private let changed Action
    private let output OutputTail = OutputTail(5000)
    private var lines chan[string]?
    private var approvalTimer IDisposable?
    private var approvalCheck CliClient?
    private var defaulted bool
    private var repositoryTimer IDisposable?
    private var repositoriesLoaded bool
    let Issues IssueSearchService
    var Current DonationState = DonationState.Initial

    init(
        commands CommandRunner,
        activity ActivityService,
        feedback FeedbackService,
        dialogs DialogService,
        navigation NavigationService,
        window WindowService,
        changed Action
    ) {
        this.commands = commands
        this.activity = activity
        this.feedback = feedback
        this.dialogs = dialogs
        this.navigation = navigation
        this.window = window
        this.changed = changed
        Issues = IssueSearchService(IssueFilter.Approved, commands, activity, feedback, changed)
    }

    prop IsDonating bool -> Current.Step == DonationStep.Donation

    prop IsLive bool -> IsDonating && Current.Progress.Started

    prop IsBrowsing bool -> Current.Step == DonationStep.Issue && Issues.Current.Loaded

    private func Set(next DonationState) {
        let settled = next.Settled()
        let selectionChanged = Current.Repository != settled.Repository || Current.RepositoryMode != settled.RepositoryMode ||
            Current.PerTask != settled.PerTask || Current.Total != settled.Total || Current.Prompt != settled.Prompt ||
            Current.IssueList != settled.IssueList || Current.ReviewEach != settled.ReviewEach ||
            Current.Draft.Harness != settled.Draft.Harness || Current.Draft.Provider != settled.Draft.Provider ||
            Current.Draft.Model != settled.Draft.Model || Current.Draft.Effort != settled.Draft.Effort || Current.Draft.Endpoint != settled.Draft.Endpoint
        Current = selectionChanged ? settled with{Consent = "", ReviewedArguments = []string{}, ShowConsent = false}: settled
        changed()
    }

    private func SetDraft(draft DonationDraft) -> Set(Current with{Draft = draft})

    private func SetProgress(progress DonationProgress) -> Set(Current with{Progress = progress})

    /// Stops checking for approval. Called when the window closes.
    func Stop() {
        repositoryTimer?.Dispose()
        repositoryTimer = nil
        approvalTimer?.Dispose()
        approvalTimer = nil
        approvalCheck?.Stop()
        approvalCheck = nil
    }

    func SetInput(value string) {
        repositoryTimer?.Dispose()
        Issues.Reset("", IssueFilter.Approved)
        feedback.Clear()
        Set(Current with{Input = value, Account = "", RepositoryChecked = false, CheckingRepository = false, RepositoryStatus = "", Consent = "", ReviewedArguments = []string{}})
        if value.Trim() == "" { return }
        try {
            let repository = RepositoryRef.Parse(value).FullName
            Set(Current with{CheckingRepository = true})
            repositoryTimer = window.Every(400, () -> {
                repositoryTimer?.Dispose()
                repositoryTimer = nil
                go CheckRepository(value, repository)
            })
        } catch (error Exception) {
            Set(Current with{RepositoryStatus = "Use owner/repository or a GitHub URL.", RepositoryTone = Tone.Need})
        }
    }

    private func CheckRepository(input string, repository string) {
        let exists = GitHubClient().Run[ProjectInfo](GitHubCommands.Repository(repository), value -> GitHubCodec.Project(repository, value), 20)
        if exists.Outcome.Failure != "" || exists.Outcome.ExitCode != 0 {
            window.Post(() -> {
                if Current.Input == input {
                    Set(Current with{CheckingRepository = false, RepositoryStatus = "Repository not found or unavailable. Check the name and GitHub sign-in.", RepositoryTone = Tone.Fail})
                }
            })
            return
        }
        let policy = CliClient().Run[Policy](TokateCommands.Policy(repository), PolicyCodec.FromPolicyResult, 30)
        window.Post(() -> {
            if Current.Input != input { return }
            if policy.Outcome.Failure != "" || policy.Outcome.ExitCode != 0 {
                Set(Current with{CheckingRepository = false, RepositoryStatus = "Could not check repository policy. Try again.", RepositoryTone = Tone.Fail})
                return
            }
            Set(Current with{Policy = policy.Value, RepositoryChecked = true, CheckingRepository = false})
            Set(Current with{RepositoryStatus = policy.Value.Loaded ? "Owner policy · " + Current.LimitLabel + " per task": "Gratis · No Tokate policy", RepositoryTone = Tone.Done})
        })
    }

    func SetRepositoryMode(value bool) {
        Issues.Reset("", IssueFilter.Approved)
        Set(Current with{RepositoryMode = value, Account = "", Consent = "", ReviewedArguments = []string{}})
    }

    func SetPerTask(value string) {
        if int32.TryParse(value, out var minutes) && minutes > 0 && (Current.LimitMinutes == 0 || minutes <= Current.LimitMinutes) {
            Set(Current with{PerTask = value})
        }
    }

    func SetTotal(value string) -> Set(Current with{Total = value})

    func SetPrompt(value string) -> Set(Current with{Prompt = value})

    func SetIssueList(value string) -> Set(Current with{IssueList = value})

    func SetReviewEach(value bool) -> Set(Current with{ReviewEach = value})

    func ToggleConsent() -> Set(Current with{ShowConsent = !Current.ShowConsent})

    func PickRepository(value string) {
        SetInput(value)
        Find()
    }

    /// Lists the repository's approved issues, or goes straight to the issue an issue URL names.
    func Find() {
        try {
            repositoryTimer?.Dispose()
            repositoryTimer = nil
            let reference = RepositoryRef.Parse(Current.Input)
            let requested = reference.IssueNumber()
            let repository = reference.FullName
            Issues.Reset(repository, IssueFilter.Approved)
            Set(
                Current with{
                    Repository = repository,
                    CheckingRepository = false,
                    Account = "",
                    Issue = "",
                    IssueTitle = "",
                    Draft = Current.Draft with{Unlimited = false},
                }
            )
            commands.GitHub[string](
                GitHubCommands.User(),
                GitHubCodec.Login,
                (user Reply[string]) -> {
                    if commands.Failed(user.Outcome) {
                        return
                    }
                    Set(Current with{Account = user.Value ?? ""})
                    LoadPolicy(repository, requested)
                    return
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    private func LoadPolicy(repository string, requested int32) {
        commands.Cli[Policy](
            TokateCommands.Policy(repository),
            PolicyCodec.FromPolicyResult,
            (reply Reply[Policy]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                let limit = reply.Value.MaxSeconds > 0 ? Math.Max(1, reply.Value.MaxSeconds / 60): 60
                let total = Math.Min(60, limit)
                let verification = Math.Min(30, Math.Max(1, total / 2))
                Set(Current with{
                    Policy = reply.Value, RepositoryChecked = true, CheckingRepository = false,
                    PerTask = total.ToString(), IssueList = "", ReviewEach = false, Prompt = "",
                    Draft = Current.Draft with{Coding = Math.Max(1, total - verification).ToString(), Verification = verification.ToString()},
                })
                RunStore.RememberRepository(repository)
                Set(Current with{RecentRepositories = RunStore.ReadRepositories()})
                if Current.RepositoryMode {
                    Set(Current with{Step = DonationStep.Limits, Unready = HarnessDoctor.Known})
                    LoadProfiles(() -> StartWithDefault())
                    go CheckHarnesses()
                    return
                }
                if !reply.Value.Loaded {
                    feedback.Show("No approved issues here. Choose Repository donation for Gratis work.", Tone.Need)
                    return
                }
                if requested == 0 {
                    Issues.Search(1, true)
                } else {
                    LoadIssue(repository, requested.ToString())
                }
            }
        )
    }

    private func LoadIssue(repository string, number string) {
        commands.GitHub[Issue](
            GitHubCommands.Issue(repository, number),
            IssueCodec.Issue,
            (reply Reply[Issue]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                let issue = reply.Value
                if issue.IsPullRequest {
                    feedback.Show("This is a pull request. Choose an issue.")
                } else if !issue.IsOpen {
                    feedback.Show("Issue #" + number + " is closed.")
                } else if !issue.IsApproved {
                    feedback.Show("Issue #" + number + " needs owner approval.")
                } else {
                    Choose(issue)
                }
            }
        )
    }

    func ChangeRepository() {
        Issues.Reset("", IssueFilter.Approved)
        Set(Current with{Account = ""})
    }

    /// Moves to limits for `issue` and loads the donor's saved profiles and Codex's models.
    func Choose(issue Issue) {
        Set(Current with{Issue = issue.NumberText, IssueTitle = issue.Title, Step = DonationStep.Limits, Unready = HarnessDoctor.Known})
        LoadProfiles(() -> StartWithDefault())
        go CheckHarnesses()
    }

    /// Selects the default profile once, when the owner allows its harness and the donor selected no profile.
    private func StartWithDefault() {
        for profile in Current.Profiles {
            if profile.Default && !defaulted && Current.Draft.Profile == "" && Current.Policy.AllowsHarness(profile.Harness) {
                defaulted = true
                SetDraft(Current.Draft.UsingProfile(profile))
            }
        }
        LoadModels()
    }

    private func LoadProfiles(then Action? = nil) {
        commands.Cli[[]DonorProfile](
            TokateCommands.DefaultsList(),
            DonorCodec.Profiles,
            (reply Reply[[]DonorProfile]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                let profiles = reply.Value ?? []DonorProfile{}
                var draft = Current.Draft
                if draft.Profile != "" && !Array.Exists(profiles, profile -> profile.Name == draft.Profile) {
                    draft = draft with{Profile = ""}
                }
                Set(Current with{Profiles = profiles, Draft = draft})
                then?.Invoke()
            }
        )
    }

    private func LoadModels() {
        let harness = Current.Draft.Harness
        if harness == "codex" && Current.Models.Length == 0 {
            commands.Models(harness, models -> Set(Current with{Models = models}))
        }
        if harness == "omp" && Current.OmpModels.Length == 0 {
            commands.Models(harness, models -> Set(Current with{OmpModels = models}))
        }
    }

    /// Finds the harnesses that are not set up. Runs on a worker, apart from the visible commands.
    private func CheckHarnesses() {
        let unready = HarnessDoctor.Unready()
        window.Post(() -> Set(Current with{Unready = unready}))
    }

    func ChooseHarness(id string) {
        let providers = Current.Policy.Providers(id)
        SetDraft(Current.Draft.ForHarness(id) with{Provider = (id == "omp" || id == "command") && providers.Length > 0 ? providers[0]: ""})
        LoadModels()
    }

    func UseProfile(profile DonorProfile) {
        SetDraft(Current.Draft.UsingProfile(profile))
        LoadModels()
    }

    /// Reads the saved profiles again when the donor returns to the limits.
    func Enter() {
        if !repositoriesLoaded {
            repositoriesLoaded = true
            go LoadRepositories()
        }
        if Current.Step == DonationStep.Limits {
            LoadProfiles(() -> StartWithDefault())
        }
    }

    private func LoadRepositories() {
        let recent = RunStore.ReadRepositories()
        let saved = List[string](RunStore.SavedRepositories())
        let reply = GitHubClient().Run[[]ProjectChoice](GitHubCommands.Repositories(), GitHubCodec.Projects, 20)
        if reply.Outcome.Failure == "" && reply.Outcome.ExitCode == 0 {
            for project in reply.Value ?? []ProjectChoice{} {
                if !saved.Contains(project.Repository) { saved.Add(project.Repository) }
            }
        }
        window.Post(() -> Set(Current with{RecentRepositories = recent, SavedRepositories = saved.ToArray()}))
    }

    func SetModel(model string) -> SetDraft(Current.Draft.WithModel(model, Current.Catalog()))

    func SetEffort(effort string) -> SetDraft(Current.Draft with{Effort = effort, Profile = ""})

    /// Selects an OMP provider. The model belongs to the earlier provider, so it is cleared.
    func SetProvider(provider string) -> SetDraft(Current.Draft with{Provider = provider, Model = "", Effort = "", Profile = ""})

    func SetEndpoint(endpoint string) -> SetDraft(Current.Draft with{Endpoint = endpoint, Profile = ""})

    func SetCoding(minutes string) {
        if int32.TryParse(minutes, out var total) {
            let verification = Math.Min(Current.Draft.ReserveMinutes(), Math.Max(1, total - 1))
            if total >= 2 && !Current.Policy.Exceeds(total * 60) {
                SetDraft(Current.Draft with{Coding = (total - verification).ToString(), Verification = verification.ToString(), Unlimited = false})
            }
        }
    }

    func SetVerification(minutes string) {
        if int32.TryParse(minutes, out var reserve) {
            let total = int32.Parse(Current.Draft.Coding) + Current.Draft.ReserveMinutes()
            if reserve >= 1 && reserve < total {
                SetDraft(Current.Draft with{Coding = (total - reserve).ToString(), Verification = minutes})
            }
        }
    }

    func SetUnlimited(unlimited bool) {
        if !unlimited || Current.Policy.AllowsUnlimited {
            SetDraft(Current.Draft with{Unlimited = unlimited})
        }
    }

    func Back() {
        feedback.Clear()
        Set(Current with{Step = DonationStep.Issue})
    }

    /// Checks the selection with the CLI, which resolves profiles and defaults, then moves to review.
    func Review() {
        if Current.RepositoryMode {
            PreviewRepository()
            return
        }
        try {
            Current.Draft.BudgetSeconds(Current.Policy)
            commands.Cli[DonorProfile](
                TokateCommands.DefaultsCheck(Current.Repository, Current.Draft),
                DonorCodec.Selection,
                (reply Reply[DonorProfile]) -> {
                    if commands.Failed(reply.Outcome) {
                        return
                    }
                    let selection = reply.Value
                    Set(
                        Current with{
                            Draft = Current.Draft with{
                                Harness = selection.Harness,
                                Provider = selection.Provider,
                                Model = selection.Model,
                                Effort = selection.Effort,
                            },
                            Step = DonationStep.Review,
                        }
                    )
                    feedback.Clear()
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    func ChangeDetails() -> Set(Current with{Step = DonationStep.Limits})

    /// Asks the coordinator to reserve the issue with the reviewed selection and limits.
    func Reserve() {
        try {
            let draft = Current.Draft
            let arguments = TokateCommands.Claim(
                Current.Repository,
                draft,
                Current.Issue,
                draft.BudgetSeconds(Current.Policy)
            )
            var consent = ""
            if draft.Harness == "command" {
                var command = ""
                for tool in Current.Policy.ToolModels {
                    if tool.Tool == "command/" + draft.Provider && tool.Command.Length > 0 {
                        command = Json.StringArray(tool.Command)
                    }
                }
                if command == "" {
                    throw Exception("Tokate did not provide the owner command. Inspect the repository policy before donating.")
                }
                consent = "This owner-defined command runs with your tools and has no isolation.\n\n" + command
            }
            dialogs.Ask(
                Confirmation{
                    Title: "Reserve this contribution?",
                    Text: consent,
                    ConfirmLabel: "Send request",
                    Heading: Current.Identity,
                    Tiles: []ConfirmationTile{
                        ConfirmationTile{
                            Title: "Coding",
                            Value: draft.Unlimited ? "Unlimited": draft.Coding + " minutes",
                            Icon: "schedule",
                        },
                        ConfirmationTile{Title: "Verification", Value: draft.Verification + " minutes", Icon: "verified"},
                    },
                    Details: []ConfirmationDetail{
                        ConfirmationDetail{Label: "Model", Value: draft.Model + " / " + draft.Effort},
                    },
                },
                () -> Claim(arguments)
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    private func Claim(arguments []string) {
        Set(
            Current with{
                Step = DonationStep.Donation,
                Progress = DonationProgress.Empty with{State = "Reserving donation"},
            }
        )
        commands.Cli(
            arguments,
            (outcome CommandOutcome) -> {
                if outcome.Failure != "" {
                    SetProgress(Current.Progress with{State = "Reservation needs attention", Tone = Tone.Fail})
                    return
                }
                let directory = outcome.RunPath
                if directory != "" && (outcome.ExitCode == 0 || outcome.ExitCode == 8) {
                    commands.Cli[Run](
                        TokateCommands.Status(directory),
                        RunCodec.Reader(directory),
                        (status Reply[Run]) -> {
                            if !commands.Failed(status.Outcome) {
                                Open(status.Value with{Warning = status.Outcome.Warning}, directory)
                            }
                        }
                    )
                    return
                }
                Set(
                    Current with{
                        Step = DonationStep.Review,
                        Progress = Current.Progress with{State = "Reservation needs attention", Tone = Tone.Fail},
                    }
                )
                if directory != "" {
                    commands.RememberRun?.Invoke(directory)
                }
                feedback.ShowReport(outcome.Report)
            },
            seconds: 600,
            completeOnError: true
        )
    }

    /// Shows a reserved run. A run still waiting for approval is checked now and every minute.
    func Open(run Run, directory string) {
        commands.RememberRun?.Invoke(directory)
        Stop()
        output.Clear()
        let ready = run.State == "claimed"
        feedback.Clear()
        Set(
            Current with{
                RepositoryMode = false,
                Step = DonationStep.Donation,
                Progress = DonationProgress.Empty with{
                    Path = directory,
                    Run = run,
                    Ready = ready,
                    Polling = run.State == "claim_pending",
                    State = ready ? "Ready to start": "Waiting for approval",
                    Tone = ready ? Tone.Need: Tone.Wait,
                },
            }
        )
        if run.State == "claim_pending" {
            approvalTimer = window.Every(60000, () -> CheckApproval())
            CheckApproval()
        }
    }

    /// Checks in the background whether the coordinator has approved this reservation.
    private func CheckApproval() {
        let progress = Current.Progress
        if activity.Busy || navigation.Current != Destination.Donate || progress.Ready || progress.Started || approvalCheck != nil {
            return
        }
        let client = CliClient()
        approvalCheck = client
        go ReadApproval(client, progress.Run, progress.Path)
    }

    private func ReadApproval(client CliClient, run Run, directory string) {
        var ready = false
        var error = ""
        try {
            let claim = RunStore.ClaimId(directory)
            let reply = client.Run[Reservation](
                TokateCommands.IssueStatus(run.Repo, run.Issue.ToString()),
                RunCodec.Reservation
            )
            if reply.Outcome.Failure != "" || reply.Outcome.ExitCode != 0 {
                throw Exception("Approval check unavailable. Checking again shortly.")
            }
            ready = reply.Value.IsReadyFor(run, claim, DateTimeOffset.UtcNow.ToUnixTimeSeconds())
        } catch (failure Exception) {
            error = failure.Message
        }
        window.Post(() -> ApprovalChecked(client, directory, ready, error))
    }

    private func ApprovalChecked(client CliClient, directory string, ready bool, error string) {
        if approvalCheck != client || Current.Progress.Path != directory {
            return
        }
        approvalCheck = nil
        if ready {
            approvalTimer?.Dispose()
            approvalTimer = nil
        }
        SetProgress(
            Current.Progress with{
                Ready = ready,
                Polling = !ready,
                State = ready ? "Ready to start": error == "" ? "Waiting for approval": error,
                Tone = ready ? Tone.Need: Tone.Wait,
            }
        )
    }

    /// Starts the approved donation after the donor confirms its budget.
    func Start() {
        let progress = Current.Progress
        if !progress.Ready || activity.Busy {
            return
        }
        let run = progress.Run
        dialogs.Ask(
            Confirmation{
                Title: "Start donation?",
                Text: run.Harness == "command" ? "This owner-defined command runs with your tools and has no isolation.": "",
                ConfirmLabel: "Start this donation",
                Heading: run.Identity,
                Tiles: []ConfirmationTile{
                    ConfirmationTile{Title: "Coding", Value: run.CodingTime, Icon: "schedule"},
                    ConfirmationTile{Title: "Verification", Value: run.VerificationTime, Icon: "verified"},
                },
                Details: []ConfirmationDetail{
                    ConfirmationDetail{
                        Label: "Model",
                        Value: (run.Harness == "" ? "": run.Harness + " / ") + run.Model + " / " + run.Effort,
                    },
                },
            },
            () -> Work(progress.Path, run)
        )
    }

    private func Work(directory string, run Run) {
        output.Clear()
        let channel = chan[string](output.Limit)
        lines = channel
        SetProgress(
            Current.Progress with{
                Started = true,
                Running = true,
                Ready = false,
                Polling = false,
                State = "Donation running",
                Tone = Tone.Need,
                Output = output.Lines,
                OutputRevision = output.Revision,
                Truncated = false,
                Elapsed = 0,
            }
        )
        commands.Stream[Run](
            TokateCommands.Work(directory),
            RunCodec.Reader(""),
            channel,
            seconds -> Collect(seconds),
            (reply Reply[Run]) -> Finished(reply),
            run.Unlimited ? 0: Math.Clamp(run.Seconds + 600, 600, 87000)
        )
    }

    /// Appends the output lines that arrived since the last tick to the tail.
    private func Collect(seconds int32) {
        if let channel = lines {
            while channel.Reader.TryRead(out var line) {
                output.Append(line)
            }
        }
        let progress = Current.Progress
        if progress.OutputRevision != output.Revision || progress.Elapsed != seconds {
            SetProgress(
                progress with{
                    Elapsed = seconds,
                    Output = output.Lines,
                    OutputRevision = output.Revision,
                    Truncated = output.Dropped,
                }
            )
        }
    }

    private func Finished(reply Reply[Run]) {
        Collect(Current.Progress.Elapsed)
        lines = nil
        let outcome = reply.Outcome
        let stopped = activity.Current.Stopping
        let failed = outcome.Failure != "" || outcome.ExitCode != 0
        var progress = Current.Progress with{
            Running = false,
            State = stopped ? "Donation stopped": failed ? "Donation needs attention": "Donation finished",
            Tone = stopped ? Tone.Wait: failed ? Tone.Fail: Tone.Done,
        }
        if outcome.Failure != "" {
            output.Append(outcome.Failure)
            progress = progress with{Output = output.Lines, OutputRevision = output.Revision, Truncated = output.Dropped}
        } else if reply.Value.Path != "" {
            progress = progress with{Run = reply.Value with{Warning = outcome.Warning}}
        }
        SetProgress(progress)
    }

    private func PreviewRepository() {
        try {
            if !int32.TryParse(Current.PerTask, out var minutes) || minutes < 1 || (Current.LimitMinutes > 0 && minutes > Current.LimitMinutes) {
                throw Exception("Choose a per-task time within the repository limit.")
            }
            if Current.Policy.Loaded && ((Current.IssueList ?? "") != "" || Current.ReviewEach || Current.Prompt != "") {
                throw Exception("Issue lists, review and guidance require Gratis mode.")
            }
            let issueList = (Current.IssueList ?? "").Trim()
            if issueList.Contains("#") && !String.Equals(issueList.Split('#')[0], Current.Repository, StringComparison.OrdinalIgnoreCase) {
                throw Exception("Choose issues from this repository.")
            }
            let arguments = TokateCommands.RepositoryWork(Current.Repository, Current.Draft, Current.PerTask, Current.Total, Current.Prompt, issueList, Current.ReviewEach)
            commands.Cli(
                arguments,
                (outcome CommandOutcome) -> {
                    let current = TokateCommands.RepositoryWork(Current.Repository, Current.Draft, Current.PerTask, Current.Total, Current.Prompt, Current.IssueList, Current.ReviewEach)
                    if String.Join("\n", current) != String.Join("\n", arguments) { return }
                    if outcome.Failure != "" || outcome.Envelope?.Error?.Code != "confirmation_required" {
                        feedback.ShowError(outcome)
                        return
                    }
                    if outcome.Diagnostics.Trim() == "" {
                        feedback.Show("The CLI did not return the repository consent. Nothing started.", Tone.Fail)
                        return
                    }
                    feedback.Clear()
                    Set(Current with{Consent = outcome.Diagnostics.Trim(), ReviewedArguments = arguments, Step = DonationStep.Review})
                },
                completeOnError: true
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    func StartRepository() {
        if activity.Busy || Current.Consent == "" || Current.ReviewedArguments.Length == 0 {
            return
        }
        dialogs.Ask(
            Confirmation{Title: "Start donation?", Text: Current.Repository + "\n" + ModelChoice.Tool(Current.Draft.Harness, Current.Draft.Provider) + " · " + Current.Draft.Model + "\nPer task: " + DonationState.Duration(int32.Parse(Current.PerTask)) + "\nTotal: " + (Current.Total == "" ? "Until stopped": DonationState.Duration(int32.Parse(Current.Total))), ConfirmLabel: "Confirm donation"},
            () -> WorkRepository()
        )
    }

    private func WorkRepository() {
        let current = TokateCommands.RepositoryWork(Current.Repository, Current.Draft, Current.PerTask, Current.Total, Current.Prompt, Current.IssueList, Current.ReviewEach)
        if Current.Consent == "" || String.Join("\n", current) != String.Join("\n", Current.ReviewedArguments) { return }
        output.Clear()
        let channel = chan[string](output.Limit)
        lines = channel
        let arguments = List[string](Current.ReviewedArguments)
        arguments.Add("--yes")
        Set(Current with{
            Step = DonationStep.Donation,
            Session = DonationSession{},
            StopRequested = false,
            Progress = DonationProgress.Empty with{Started = true, Running = true, State = "Choosing and completing tasks. Each task uses the reviewed time limit.", Tone = Tone.Need},
        })
        commands.Stream[DonationSession](
            arguments.ToArray(), DonorCodec.Session, channel, seconds -> Collect(seconds),
            (reply Reply[DonationSession]) -> {
                Collect(Current.Progress.Elapsed)
                lines = nil
                let failed = reply.Outcome.Failure != "" || reply.Outcome.ExitCode != 0
                Set(Current with{
                    Session = reply.Value,
                    Progress = Current.Progress with{
                        Running = false,
                        State = failed ? "Repository donation needs attention": "Repository donation finished",
                        Tone = failed ? Tone.Fail: Tone.Done,
                    },
                })
            },
            0
        )
    }

    func StopRepository() {
        if !Current.Progress.Running || Current.StopRequested {
            return
        }
        dialogs.Ask(
            Confirmation{
                Title: "Stop repository donation?", Heading: Current.Repository,
                Text: "Finish the current task, then stop. Progress stays visible while the task finishes.",
                ConfirmLabel: "Stop after current task",
            },
            () -> {
                Set(Current with{StopRequested = true})
                go RequestRepositoryStop(Current.Repository)
            }
        )
    }

    private func RequestRepositoryStop(repository string) {
        let outcome = CliClient().Run(TokateCommands.RepositoryStop(repository), 0)
        window.Post(() -> {
            if outcome.Failure != "" || outcome.ExitCode != 0 {
                Set(Current with{StopRequested = false})
                feedback.ShowError(outcome)
            }
        })
    }

    func NewDonation() {
        feedback.Clear()
        Set(Current with{Step = DonationStep.Issue, Consent = "", ReviewedArguments = []string{}, Progress = Current.Progress with{Started = false}})
    }
}
