package TokateDesktop

import System
import System.Text.RegularExpressions
import System.Collections.Generic

/// The owner's project: issues and their contributions, donor access, and project setup.
class OwnerService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let dialogs DialogService
    private let changed Action
    let Issues IssueSearchService
    private var catalogs bool
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

    /// Changes to the project or setup clear the last preview and result.
    private func Edit(next OwnerState) -> Set(next with{Written = "", SetupPreviewed = false, SetupReport = SetupReport{}})

    private func EditSetup(setup SetupDraft) -> Edit(Current with{Setup = setup})

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
        Set(Current with{
            Open = true, Selected = nil, Project = reply.Value, Written = "", DoctorReport = "",
            SetupPreviewed = false, SetupReport = SetupReport{},
        })
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
                PolicyTruncated = reply.Outcome.Envelope?.Truncated ?? false,
                Project = project,
                Setup = SetupDraft.From(policy) with{Step = Current.Setup.Step},
            }
        )
        if reply.Outcome.ExitCode != 0 {
            Set(Current with{Tab = OwnerTab.Setup})
            feedback.Show("Project policy could not be loaded. Check access before applying setup.")
            return
        }
        if !policy.Loaded {
            Set(Current with{Tab = OwnerTab.Setup})
            feedback.Show("No policy yet. Preview project setup, or check repository health.")
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
        let repository = Current.Open ? Repository: ""
        commands.Cli[string](
            Current.Open ? TokateCommands.Policy(Repository): TokateCommands.OwnerDoctor(),
            PolicyCodec.OwnerHealth,
            (reply Reply[string]) -> {
                let outcome = reply.Outcome
                Set(Current with{DoctorReport = !String.IsNullOrEmpty(reply.Value) ? reply.Value: outcome.Report})
                if !commands.Failed(outcome) {
                    feedback.Show(repository == "" ? "Owner prerequisites checked.": "Owner repository health checked.", Tone.Done)
                }
            }
        )
    }

    func SelectTab(tab OwnerTab) {
        Set(Current with{Tab = tab})
        if tab == OwnerTab.Access {
            LoadAccess()
        }
        if tab == OwnerTab.Setup {
            LoadCatalogs()
        }
    }

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
        var drafts = []string{}
        for work in Current.Work {
            if work.Issue == number {
                drafts = work.Drafts
            }
        }
        Confirm(
            "Approve issue #" + number,
            TokateCommands.Approve(Repository, number, branch),
            "Authorize issue #" + number + " on " + branch + " under the current project policy." +
                "\n\nThis ends any reservation or published PR authority under an earlier approval." +
                (drafts.Length > 0 ? "\n\nThis issue has a contribution under an earlier approval (PR #" + String.Join(", #", drafts) +
                "). A new approval replaces its reservation, and the donor cannot amend the contribution after that.": ""),
            false
        )
    }

    func Revoke(issue Issue) -> Confirm(
        "Revoke issue approval #" + issue.NumberText,
        TokateCommands.Revoke(Repository, issue.NumberText),
        "Stop future work under this approval.",
        false
    )

    func CheckPullRequest(pr string) {
        commands.Cli[DraftReview](
            TokateCommands.PullRequestCheck(Repository, pr),
            PullRequestCodec.Review,
            (reply Reply[DraftReview]) -> {
                if commands.Failed(reply.Outcome) && !reply.Outcome.Pending {
                    return
                }
                if String.IsNullOrEmpty(reply.Value.Receipt) && String.IsNullOrEmpty(reply.Value.Ci) {
                    return
                }
                if reply.Value.Ci == DraftReview.NeedsApproval {
                    feedback.Show(
                        "The workflows of PR #" + pr + " wait for your approval. Inspect the diff, then approve the runs in GitHub.",
                        Tone.Need
                    )
                }
                let reviews = List[DraftReview](Current.Reviews)
                reviews.RemoveAll(existing -> existing.Pr == pr)
                reviews.Add(reply.Value with{Pr = pr})
                Set(Current with{Reviews = reviews.ToArray()})
            }
        )
    }

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

    /// Allows or removes a harness with one provider. OMP opens its provider list, or removes all its
    /// providers. At least one pair stays allowed.
    func ToggleTool(id string) {
        let pairs = List[string](Current.Setup.EffectiveTools())
        if id == "omp" {
            let providers = pairs.FindAll(pair -> pair.StartsWith("omp/"))
            if providers.Count == 0 {
                Set(Current with{OmpOpen = !Current.OmpOpen})
            } else if providers.Count < pairs.Count {
                pairs.RemoveAll(pair -> pair.StartsWith("omp/"))
                Edit(Current with{OmpOpen = false, Setup = Current.Setup with{Tools = String.Join(",", pairs), PermissionsChanged = true}})
                if !pairs.Contains(Current.Setup.ModelTool) {
                    SetModelTool(pairs[0])
                }
            }
            return
        }
        TogglePair(id + "/" + HarnessOption.ProviderOf(id))
    }

    /// Allows or removes an OMP provider.
    func ToggleProvider(provider string) {
        let name = provider.Trim()
        if !Regex.IsMatch(name, "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$") {
            feedback.Show("Enter the provider name that OMP uses, for example openrouter.", Tone.Fail)
            return
        }
        TogglePair("omp/" + name)
    }

    private func TogglePair(pair string) {
        let pairs = List[string](Current.Setup.EffectiveTools())
        if !pairs.Remove(pair) {
            pairs.Add(pair)
        } else if pairs.Count == 0 {
            pairs.Add(pair)
        }
        EditSetup(Current.Setup with{Tools = String.Join(",", pairs), PermissionsChanged = true})
        if !pairs.Contains(Current.Setup.ModelTool) {
            SetModelTool(pairs[0])
        }
    }

    /// Reads the model catalogs of this computer for the setup pickers, once.
    private func LoadCatalogs() {
        if catalogs {
            return
        }
        catalogs = true
        commands.Catalogs((codex, omp) -> Set(Current with{Codex = codex, Omp = omp}))
    }

    func SetModelTool(tool string) {
        var models = []ModelAllowance{}
        var restricted = false
        for allowance in Current.Setup.ToolModels {
            if allowance.Tool == tool {
                models = allowance.Models
                restricted = allowance.Restricted
            }
        }
        EditSetup(Current.Setup with{
            ModelTool = tool,
            Models = models,
            ModelPolicy = restricted ? "whitelist": "unrestricted",
        })
    }

    func SetModelPolicy(policy string) {
        let setup = Current.Setup
        let tools = List[ToolAllowance](setup.ToolModels)
        let previous = Array.Find(setup.ToolModels, tool -> tool.Tool == setup.ModelTool)
        let allowance = previous with{Tool = setup.ModelTool, Models = setup.Models, Restricted = policy == "whitelist"}
        let index = tools.FindIndex(tool -> tool.Tool == setup.ModelTool)
        if index >= 0 {
            tools[index] = allowance
        } else {
            tools.Add(allowance)
        }
        EditSetup(setup with{ModelPolicy = policy, ToolModels = tools.ToArray(), PermissionsChanged = true})
    }

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

    private func SetModels(models []ModelAllowance) {
        EditSetup(Current.Setup with{Models = models})
        SetModelPolicy("whitelist")
    }

    func SetMinutes(value string) -> EditSetup(Current.Setup with{Minutes = value})

    func AddCommandTool(provider string, argv string, output string) {
        try {
            let name = provider.Trim()
            let words = Json.Strings(Json.Parse(argv))
            let pair = "command/" + name
            let tools = List[ToolAllowance](Current.Setup.ToolModels)
            let index = tools.FindIndex(tool -> tool.Tool == pair)
            let previous = index >= 0 ? tools[index]: ToolAllowance{Models: []ModelAllowance{}}
            let tool = previous with{Tool = pair, Command = words, Output = output, Restricted = true}
            if index >= 0 {
                tools[index] = tool
            } else {
                tools.Add(tool)
            }
            let pairs = List[string](Current.Setup.EffectiveTools())
            if !pairs.Contains(pair) {
                pairs.Add(pair)
            }
            EditSetup(Current.Setup with{Tools = String.Join(",", pairs), ToolModels = tools.ToArray(), PermissionsChanged = true})
            SetModelTool(pair)
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    func RemoveCommandTool(pair string) -> TogglePair(pair)

    func PreviewSetup() {
        try {
            if Current.PolicyTruncated {
                throw Exception("The CLI omitted policy entries. Use tokate init to preserve the complete tool permissions.")
            }
            commands.Cli[SetupReport](
                TokateCommands.Init(Repository, Current.Setup, false),
                PolicyCodec.Setup,
                (reply Reply[SetupReport]) -> {
                    let failed = commands.Failed(reply.Outcome)
                    Set(Current with{
                        SetupReport = reply.Value, SetupPreviewed = !failed,
                        Written = failed ? reply.Outcome.Diagnostics: "",
                    })
                }
            )
        } catch (error Exception) {
            feedback.Show(error.Message, Tone.Fail)
        }
    }

    /// Applies the previewed GitHub setup after confirmation.
    func Apply() {
        if !Current.SetupPreviewed || Current.SetupReport.Applied {
            return
        }
        let arguments = TokateCommands.Init(Repository, Current.Setup)
        dialogs.Ask(
            Confirmation{
                Title: "Apply project setup?",
                Text: Repository + "\n\nCreate or update the setup PR with the policy and pinned coordinator workflow. " +
                    "Tokate also updates the Actions workflow allowlist and event policy, allows Actions to create and approve pull requests, " +
                    "adds required checks to target-branch protection, and initializes the donor access record when missing." +
                    "\n\nReview and merge the setup PR before approving work. Complete the reported manual steps. Existing checks are preserved unless you explicitly replaced them.",
                ConfirmLabel: "Confirm", Heading: "",
            },
            () -> commands.Cli[SetupReport](
                arguments,
                PolicyCodec.Setup,
                (reply Reply[SetupReport]) -> {
                    Set(Current with{SetupReport = reply.Value, Written = reply.Outcome.ExitCode != 0 ? reply.Outcome.Diagnostics: ""})
                    if !commands.Failed(reply.Outcome) {
                        Set(Current with{SetupPreviewed = false})
                        feedback.Show(reply.Value.Applied ? "Setup applied. Review and merge the setup PR before approving issues.": "Setup already matches. Complete any manual steps and review the setup PR.", Tone.Done)
                    }
                }
            )
        )
    }
}
