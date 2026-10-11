package TokateDesktop

import System
import System.Collections.Generic
import System.IO

/// The owner's project: issues and their contributions, donor access, and project setup.
class OwnerService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let dialogs DialogService
    private let changed Action
    let Issues IssueSearchService
    var Current OwnerState = OwnerState.Initial

    init(
        commands CommandRunner,
        activity ActivityService,
        feedback FeedbackService,
        dialogs DialogService,
        changed Action
    ) {
        this.commands = commands
        this.activity = activity
        this.feedback = feedback
        this.dialogs = dialogs
        this.changed = changed
        Issues = IssueSearchService(IssueFilter.All, commands, activity, feedback, changed)
    }

    prop Repository string -> Current.Project.Repository

    private func Set(next OwnerState) {
        Current = next
        changed()
    }

    /// Changes to the project or setup clear the report of the last written setup.
    private func Edit(next OwnerState) -> Set(next with{Written = ""})

    private func EditSetup(setup SetupDraft) -> Edit(Current with{Setup = setup})

    // Project

    /// Called when the page opens: reads the user's repositories the first time.
    func Enter() {
        if !Current.Open && !Current.ProjectsLoaded && !activity.Busy {
            activity.Activate("Refresh projects")
            LoadProjects()
        }
    }

    func LoadProjects() {
        commands.GitHub[[]ProjectChoice](
            GitHubCommands.Repositories(),
            GitHubCodec.Projects,
            (reply Reply[[]ProjectChoice]) -> {
                if !commands.Failed(reply.Outcome) {
                    Set(Current with{Projects = reply.Value, ProjectsLoaded = true})
                }
            }
        )
    }

    func SetInput(value string) -> Edit(Current with{Input = value})

    func OpenRepository(repository string) {
        Edit(Current with{Input = repository})
        Open()
    }

    func Open() {
        try {
            let repository = RepositoryRef.Parse(Current.Input).FullName
            Edit(Current with{Input = repository})
            commands.GitHub[ProjectInfo](
                GitHubCommands.Repository(repository),
                value -> GitHubCodec.Project(repository, value),
                (reply Reply[ProjectInfo]) -> Opened(reply)
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    private func Opened(reply Reply[ProjectInfo]) {
        if commands.Failed(reply.Outcome) {
            return
        }
        Issues.Reset(reply.Value.Repository, IssueFilter.All)
        Set(Current with{Open = true, Selected = nil, Project = reply.Value})
        activity.Activate("Refresh project")
        commands.Cli[Policy](
            TokateCommands.Policy(reply.Value.Repository),
            PolicyCodec.FromPolicyResult,
            (policy Reply[Policy]) -> PolicyLoaded(policy)
        )
    }

    private func PolicyLoaded(reply Reply[Policy]) {
        let policy = reply.Value
        var project = Current.Project
        if policy.TargetBranch != "" {
            project = project with{Branch = policy.TargetBranch}
        }
        Edit(
            Current with{
                Policy = policy,
                Project = project,
                Setup = SetupDraft.From(policy) with{Path = Current.Setup.Path, Step = Current.Setup.Step},
            }
        )
        if reply.Outcome.ExitCode != 0 {
            Set(Current with{Tab = OwnerTab.Setup})
            feedback.Show("Project policy could not be loaded. Check access before applying setup.")
            return
        }
        LoadAccess(() -> Refresh())
    }

    func Close() -> Set(Current with{Open = false})

    func Refresh() {
        Set(Current with{Work = []IssueWork{}, Reviews = []DraftReview{}, Selected = nil})
        Issues.Search(1, true)
    }

    func CheckPrerequisites() {
        commands.Cli(
            TokateCommands.OwnerDoctor(),
            (outcome CommandOutcome) -> {
                if !commands.Failed(outcome) {
                    feedback.Show("Owner prerequisites checked.", Tone.Done)
                }
            }
        )
    }

    func SelectTab(tab OwnerTab) {
        Set(Current with{Tab = tab})
        if tab == OwnerTab.Access {
            LoadAccess()
        }
    }

    // Contributions

    func Select(issue Issue) {
        Set(Current with{Selected = issue})
        activity.Activate("Refresh contribution")
        Inspect(issue.NumberText)
    }

    func Deselect() -> Set(Current with{Selected = nil})

    func Inspect(number string) {
        commands.Cli[[]IssueWork](
            TokateCommands.IssueStatus(Repository, number),
            IssueCodec.Work,
            (reply Reply[[]IssueWork]) -> {
                let work = List[IssueWork](Current.Work)
                for item in reply.Value ?? []IssueWork{} {
                    work.RemoveAll(existing -> existing.Issue == item.Issue)
                    work.Add(item)
                }
                Set(Current with{Work = work.ToArray()})
                commands.Failed(reply.Outcome)
            }
        )
    }

    func Approve(issue Issue) {
        let number = issue.NumberText
        let branch = Current.Project.Branch
        Confirm(
            "Approve issue #" + number,
            TokateCommands.Approve(Repository, number, branch),
            "Authorize issue #" + number + " on " + branch + " under the current project policy.",
            false
        )
    }

    func Revoke(issue Issue) -> Confirm(
        "Revoke issue approval #" + issue.NumberText,
        TokateCommands.Revoke(Repository, issue.NumberText),
        "Stop future work under this approval.",
        false
    )

    func CheckPullRequest(pr string, command string) {
        commands.Cli[string](
            TokateCommands.PullRequestCheck(command, Repository, pr),
            PullRequestCodec.ChecksStatus,
            (reply Reply[string]) -> {
                let failed = commands.Failed(reply.Outcome)
                let status = (reply.Value ?? "").Replace('_', ' ')
                if command != "verify" && status == "" {
                    return
                }
                let known = Current.ReviewFor(pr)
                let reviews = List[DraftReview](Current.Reviews)
                reviews.RemoveAll(existing -> existing.Pr == pr)
                reviews.Add(command == "verify" ? known with{Receipt = failed ? "failed": "verified"}: known with{Ci = status})
                Set(Current with{Reviews = reviews.ToArray()})
            }
        )
    }

    // Access

    /// Reads donor access, then runs `then`. The count of requests on the Access tab comes from this read.
    func LoadAccess(then Action? = nil) {
        commands.Cli[AccessList](
            TokateCommands.Access(Repository, "list"),
            AccessCodec.Access,
            (reply Reply[AccessList]) -> {
                if !commands.Failed(reply.Outcome) {
                    Set(Current with{Access = reply.Value})
                }
                then?.Invoke()
            }
        )
    }

    func ChangeAccess(operation string, donor string, issue string = "") -> Confirm(
        AccessOperations.Title(operation, donor),
        TokateCommands.Access(Repository, operation, donor, issue),
        AccessOperations.Detail(operation, issue),
        true
    )

    private func Confirm(title string, arguments []string, detail string, access bool) {
        dialogs.Ask(
            Confirmation{Title: title, Text: Repository + "\n\n" + detail, ConfirmLabel: "Confirm", Heading: ""},
            () -> {
                commands.Cli(
                    arguments,
                    (outcome CommandOutcome) -> {
                        if !commands.Failed(outcome) {
                            if access {
                                LoadAccess()
                            } else {
                                Refresh()
                            }
                        }
                    }
                )
            }
        )
    }

    // Setup

    func SetStep(step int32) -> Set(Current with{Setup = Current.Setup with{Step = step}})

    func AddCommand(command string) {
        let next = List[[]string](Current.Setup.Commands)
        next.Add([]string{"/bin/sh", "-c", command})
        EditSetup(Current.Setup with{Commands = next.ToArray(), CommandsChanged = true})
    }

    func RemoveCommand(index int32) {
        let next = List[[]string](Current.Setup.Commands)
        next.RemoveAt(index)
        EditSetup(Current.Setup with{Commands = next.ToArray(), CommandsChanged = true})
    }

    func AddCheck(name string) {
        let next = List[string](Current.Setup.Checks)
        if !next.Contains(name.Trim()) {
            next.Add(name.Trim())
        }
        EditSetup(Current.Setup with{Checks = next.ToArray(), ChecksChanged = true})
    }

    func RemoveCheck(name string) {
        let next = List[string](Current.Setup.Checks)
        next.Remove(name)
        EditSetup(Current.Setup with{Checks = next.ToArray(), ChecksChanged = true})
    }

    func SetEligibility(mode string) -> EditSetup(Current.Setup with{Eligibility = mode})

    /// Adds or removes a coding tool. At least one tool stays allowed.
    func ToggleTool(id string) {
        let allowed = List[string](Current.Setup.EffectiveTools(Current.Policy))
        if allowed.Contains(id) {
            if allowed.Count > 1 {
                allowed.Remove(id)
            }
        } else {
            allowed.Add(id)
        }
        EditSetup(Current.Setup with{Tools = String.Join(",", allowed)})
    }

    func SetModelPolicy(policy string) -> EditSetup(Current.Setup with{ModelPolicy = policy})

    /// Allows `model` with comma-separated `efforts`, or "absent" when none are given.
    func AddModel(model string, efforts string) {
        let levels = List[string]()
        for value in efforts.Split(',') {
            if value.Trim() != "" {
                levels.Add(value.Trim())
            }
        }
        if levels.Count == 0 {
            levels.Add("absent")
        }
        let name = model.Trim()
        let models = List[ModelAllowance](Current.Setup.Models)
        let allowance = ModelAllowance{Model: name, Efforts: levels.ToArray()}
        let index = models.FindIndex(item -> item.Model == name)
        if index >= 0 {
            models[index] = allowance
        } else {
            models.Add(allowance)
        }
        SetModels(models.ToArray())
    }

    func RemoveModel(model string) {
        let models = List[ModelAllowance](Current.Setup.Models)
        models.RemoveAll(item -> item.Model == model)
        SetModels(models.ToArray())
    }

    private func SetModels(models []ModelAllowance) -> EditSetup(
        Current.Setup with{Models = models, ModelsJson = Json.StringListMap(models), ModelPolicy = "whitelist"}
    )

    func SetMinutes(value string) -> EditSetup(Current.Setup with{Minutes = value})

    func SetNetwork(allowed bool) -> EditSetup(Current.Setup with{Network = allowed ? "allow": "deny"})

    func SetPath(path string) -> EditSetup(Current.Setup with{Path = path})

    /// Writes the policy and workflow into the checkout after confirmation, and keeps the report of the files.
    func Apply() {
        try {
            let repository = RepositoryRef.Parse(Repository).FullName
            let setup = Current.Setup
            if !Directory.Exists(setup.CheckedPath()) {
                throw Exception("Enter an existing absolute checkout path.")
            }
            let arguments = TokateCommands.Init(repository, setup)
            dialogs.Ask(
                Confirmation{
                    Title: "Write project setup?",
                    Text: "Write the policy and workflow into " + setup.Path + ".\n\nReview and commit these files before approving work. Existing checks are preserved unless you explicitly replaced them.",
                    ConfirmLabel: "Confirm",
                    Heading: "",
                },
                () -> {
                    commands.Cli(
                        arguments,
                        (outcome CommandOutcome) -> {
                            if commands.Failed(outcome) {
                                return
                            }
                            Set(Current with{Written = outcome.Diagnostics})
                            feedback.Show("Setup written. Review and commit the files before approving issues.", Tone.Done)
                        },
                        directory: setup.Path
                    )
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }
}
