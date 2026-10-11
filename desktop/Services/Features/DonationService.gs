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
        Current = next
        changed()
    }

    private func SetDraft(draft DonationDraft) -> Set(Current with{Draft = draft})

    private func SetProgress(progress DonationProgress) -> Set(Current with{Progress = progress})

    /// Stops checking for approval. Called when the window closes.
    func Stop() {
        approvalTimer?.Dispose()
        approvalTimer = nil
        approvalCheck?.Stop()
        approvalCheck = nil
    }

    // Issue

    func SetInput(value string) {
        Issues.Reset("", IssueFilter.Approved)
        feedback.Clear()
        Set(Current with{Input = value, Account = ""})
    }

    /// Lists the repository's approved issues, or goes straight to the issue an issue URL names.
    func Find() {
        try {
            let reference = RepositoryRef.Parse(Current.Input)
            let requested = reference.IssueNumber()
            let repository = reference.FullName
            Issues.Reset(repository, IssueFilter.Approved)
            Set(
                Current with{
                    Repository = repository,
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
                Set(Current with{Policy = reply.Value})
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
        Set(Current with{Issue = issue.NumberText, IssueTitle = issue.Title, Step = DonationStep.Limits})
        commands.Cli[[]DonorProfile](
            TokateCommands.DefaultsList(),
            DonorCodec.Profiles,
            (reply Reply[[]DonorProfile]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                Set(Current with{Profiles = reply.Value ?? []DonorProfile{}})
                LoadModels()
            }
        )
    }

    private func LoadModels() {
        commands.Codex(
            (reply Reply[[]CodexModel]) -> {
                if commands.Failed(reply.Outcome) {
                    return
                }
                let visible = List[CodexModel]()
                for model in reply.Value ?? []CodexModel{} {
                    if !model.Hidden {
                        visible.Add(model)
                    }
                }
                Set(Current with{Models = visible.ToArray()})
            }
        )
    }

    // Limits

    func ChooseHarness(id string) {
        SetDraft(Current.Draft.ForHarness(id))
        if id == "codex" && Current.Models.Length == 0 {
            LoadModels()
        }
    }

    func UseProfile(profile DonorProfile) -> SetDraft(Current.Draft.UsingProfile(profile))

    /// Selects a model. A Codex effort the new model does not support is cleared.
    func SetModel(model string) {
        var draft = Current.Draft with{Model = model, Profile = ""}
        if draft.Harness == "codex" {
            Current = Current with{Draft = draft}
            if Array.IndexOf(Current.Efforts(), draft.Effort) < 0 {
                draft = draft with{Effort = ""}
            }
        }
        SetDraft(draft)
    }

    func SetEffort(effort string) -> SetDraft(Current.Draft with{Effort = effort, Profile = ""})

    func SetEndpoint(endpoint string) -> SetDraft(Current.Draft with{Endpoint = endpoint, Profile = ""})

    func ChoosePreset(minutes string) -> SetDraft(Current.Draft with{Coding = minutes, Unlimited = false})

    func SetCoding(minutes string) -> SetDraft(Current.Draft with{Coding = minutes})

    func SetVerification(minutes string) -> SetDraft(Current.Draft with{Verification = minutes})

    func SetUnlimited(unlimited bool) -> SetDraft(Current.Draft with{Unlimited = unlimited})

    func SetNetwork(network bool) -> SetDraft(Current.Draft with{Network = network})

    func Back() {
        feedback.Clear()
        Set(Current with{Step = DonationStep.Issue})
    }

    /// Checks the selection with the CLI, which resolves profiles and defaults, then moves to review.
    func Review() {
        try {
            Current.Draft.BudgetSeconds(Current.Policy)
            commands.Cli[DonorProfile](
                TokateCommands.Select(Current.Repository, Current.Draft),
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

    // Review

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
            dialogs.Ask(
                Confirmation{
                    Title: "Reserve this contribution?",
                    Text: "",
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
                        ConfirmationDetail{Label: "Network", Value: draft.Network ? "Allowed": "Offline"},
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
                                Open(status.Value, directory)
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

    // Donation

    /// Shows a reserved run. A run still waiting for approval is checked now and every five seconds.
    func Open(run Run, directory string) {
        commands.RememberRun?.Invoke(directory)
        Stop()
        output.Clear()
        let ready = run.State == "claimed"
        feedback.Clear()
        Set(
            Current with{
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
            approvalTimer = window.Every(5000, () -> CheckApproval())
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
                TokateCommands.Coordination(run.Repo, run.Issue.ToString()),
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
                Text: "",
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
                    ConfirmationDetail{Label: "Network", Value: run.Network ? "Allowed": "Offline"},
                },
            },
            () -> Work(progress.Path, run)
        )
    }

    private func Work(directory string, run Run) {
        output.Clear()
        let channel = chan[string](4096)
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
            progress = progress with{Run = reply.Value}
        }
        SetProgress(progress)
    }

    func NewDonation() {
        feedback.Clear()
        Set(Current with{Step = DonationStep.Issue, Progress = Current.Progress with{Started = false}})
    }
}
