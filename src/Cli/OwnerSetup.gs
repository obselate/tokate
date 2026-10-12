package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class OwnerSetup {
    shared {
        internal func Preview(path string, before string, after string) {
            Console.Error.WriteLine(
                (before == "" ? "Add ": before == after ? "Keep ": "Update ") + Terminal.Clean(path)
            )
            if before != "" && before != after {
                Console.Error.WriteLine("Current complete file:")
                Console.Error.WriteLine(Terminal.Clean(before))
            }
            Console.Error.WriteLine("Proposed complete file:")
            Console.Error.WriteLine(Terminal.Clean(after))
        }

        internal func Confirm(args Args) bool {
            if args.Get("yes") == "true" {
                return true
            }
            if PublicOutput.Enabled || args.Get("non-interactive") == "true" || Console.IsInputRedirected {
                Terminal.Message("Preview only; use --yes to apply these changes.", "cyan", true)
                return false
            }
            Console.Error.Write("Apply these file changes? [y/N]: ")
            return String.Equals(Console.ReadLine(), "y", StringComparison.OrdinalIgnoreCase)
        }

        private func Report(value JsonElement, before string = "") string {
            let previous = before == "" ? default(JsonElement): J.Parse(before)
            let rows = List[string]()
            for field in[]string{
                "eligibility",
                "model_policy",
                "models",
                "verification",
                "required_checks",
                "max_seconds",
                "allowed_tools",
                "target_branch",
                "reservation_seconds",
                "pr_text",
                "close_message"
            } {
                let item = J.Get(value, field)
                if field == "models" && J.Text(value, "model_policy") != "whitelist" ||
                    field == "close_message" &&
                    item.ValueKind == JsonValueKind.Undefined {
                    continue
                }
                let old = J.Get(previous, field)
                if before != "" && RequestData.Same(item, old) {
                    continue
                }
                let label = switch field {
                    case "eligibility": "Access   "
                    case "model_policy": "Models   "
                    case "models": "Allowed models   "
                    case "verification": "Checks   "
                    case "required_checks": "Required checks   "
                    case "max_seconds": "Limit    "
                    case "allowed_tools": "Tools    "
                    case "target_branch": "Branch   "
                    case "reservation_seconds": "Reserve  "
                    case "pr_text": "PR text   "
                    default: "Close message   "
                }
                var text = J.Text(value, field)
                let items = List[string]()
                if field == "verification" || field == "allowed_tools" {
                    for entry in J.Items(item) {
                        if field == "verification" {
                            items.Add(
                                entry.GetArrayLength() == 3 && entry[0].ToString() == "/bin/sh" &&
                                    entry[1].ToString() == "-c" ? entry[2].ToString(): Terminal.Command(entry)
                            )
                        } else {
                            items.Add(
                                switch J.Text(entry, "harness") {
                                    case "codex": "Codex (Subscription)"
                                    case "claude": "Claude Code (Subscription)"
                                    case "pi": "Pi (Local)"
                                    case "omp": "OMP (" + J.Text(entry, "provider") + ")"
                                    default: J.Text(entry, "harness")
                                }
                            )
                        }
                    }
                    text = String.Join(", ", items)
                } else if field == "models" && item.ValueKind == JsonValueKind.Object {
                    for entry in item.EnumerateObject() {
                        let efforts = List[string]()
                        for effort in entry.Value.EnumerateArray() {
                            efforts.Add(effort.GetString() ?? "")
                        }
                        items.Add(entry.Name + " / " + String.Join(", ", efforts))
                    }
                    text = String.Join(", ", items)
                } else if field == "required_checks" {
                    text = Terminal.Command(item)
                } else if field == "max_seconds" || field == "reservation_seconds" {
                    text = (J.Number(value, field) / 60.0).ToString("0.##") +
                        (field == "max_seconds" ? " minutes total": " minutes")
                }
                rows.Add(label + (text == "" ? "none": text.Replace('\n', ' ')))
            }
            return String.Join("\n", rows)
        }

        private func Checkout(path string) string {
            var result CommandResult
            try {
                result = Commands.Run(
                    "git",
                    []string{"-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"},
                    cwd: path,
                    seconds: 5
                )
            } catch (error Exception) {
                throw Exception(
                    Terminal.Clean(path) + " is not a Git checkout; run init inside a checkout or pass --path"
                )
            }
            if result.Code != 0 || result.Output.Trim() == "" {
                throw Exception(
                    Terminal.Clean(path) + " is not a Git checkout; run init inside a checkout or pass --path"
                )
            }
            return result.Output.Trim()
        }

        private func Answer(prompt string, fallback string = "") string ->
        WizardScreen.Read("Project setup", "", prompt, fallback)

        private func SetupPath(root string, relative string) string {
            let path = Path.Combine(root, relative)
            var current = path
            while current != root {
                if FileInfo(current).LinkTarget != nil || DirectoryInfo(current).LinkTarget != nil {
                    throw Exception("Setup refuses linked configuration paths")
                }
                current = Path.GetDirectoryName(current) ?? root
            }
            if Directory.Exists(path) {
                throw Exception("Setup file path is a directory")
            }
            return path
        }

        private func Tools(args Args, fields map[string, Object?]) {
            let value = J.Parse(J.Write(fields))
            let requested = args.Get("allowed-tools")
            if requested == "" {
                return
            }
            let selected = HashSet[string](StringComparer.Ordinal)
            let tools = List[Object]()
            if !requested.Contains('/') {
                for tool in J.Items(J.Get(value, "allowed_tools")) {
                    if (!DonorSelection.Supported(tool) || J.Text(tool, "harness") == "omp") && selected.Add(
                        J.Text(tool, "harness") + "/" + J.Text(tool, "provider")
                    ) {
                        tools.Add(tool.Clone())
                    }
                }
            }
            for name in requested.Split(',') {
                let parts = name.Trim().Split('/')
                let harness = parts[0]
                let provider = parts.Length == 2 ? parts[1]: DonorDefaults.Provider(harness)
                if parts.Length > 2 || !Regex.IsMatch(harness, "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\\z") || !Regex.IsMatch(
                    provider,
                    "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\\z"
                ) {
                    throw Exception("Use codex, claude, pi, or exact harness/provider pairs for allowed tools")
                }
                if selected.Add(harness + "/" + provider) {
                    tools.Add(map[string, Object?]{"harness": harness, "provider": provider})
                }
            }
            fields["allowed_tools"] = tools
        }

        private func Guide(args Args, fields map[string, Object?], root string) {
            let repo = args.Need("repo")
            let initial = J.Parse(J.Write(fields))
            if args.Get("eligibility") == "" && J.Text(initial, "approval_scope") == "task" {
                let modes = []string{"trusted", "open", "manual"}
                let current = Array.IndexOf(modes, J.Text(initial, "eligibility")) + 1
                fields["eligibility"] = modes[
                    WizardScreen.Choose(
                        "Who can contribute?",
                        repo + "\nApprove the task once. Choose who may claim it.",
                        []string{
                            "Trusted people   Newcomers request access first",
                            "Anyone eligible  Anyone meeting your policy may claim",
                            "Choose each time Approve each donor yourself"
                        },
                        "Choose who may claim an approved task. \"Trusted people\" limits claims to trusted donors. \"Anyone eligible\" accepts any GitHub user you have not denied. \"Choose each time\" asks you to approve each donor.",
                        current
                    ) - 1
                ]
            }
            let restriction = args.Get("model-policy") != "" ?
            (args.Get("model-policy") == "unrestricted" ? 1: 2): WizardScreen.Choose(
                "Allowed models",
                "Choose how much control you want over the coding model.",
                []string{"Any supported model", "Choose allowed models"},
                "Choose whether donors may use any supported model or only models you select. A whitelist gives you more control.",
                J.Text(initial, "model_policy") == "unrestricted" ? 1: J.Get(initial, "models")
                    .ValueKind == JsonValueKind.Object ? 2: 0
            )
            args.Values["--model-policy"] = restriction == 1 ? "unrestricted": "whitelist"
            if restriction == 2 && J.Get(initial, "models").ValueKind != JsonValueKind.Object {
                fields["models"] = RequestData.Parse(ModelChecklist().Run())
            }
            var edit = ""
            while true {
                if !fields.ContainsKey("verification") || edit == "verification" {
                    let commands = List[Object]()
                    let explanation = "A verification command is a shell command that runs the project's tests, which Tokate runs on donor work before it opens a PR."
                    var suggestion = ""
                    if File.Exists(Path.Combine(root, "pyproject.toml")) || File.Exists(
                        Path.Combine(root, "setup.py")
                    ) ||
                        Directory
                        .GetFiles(
                        root,
                        "test_*.py",
                        EnumerationOptions{RecurseSubdirectories: true, AttributesToSkip: FileAttributes.ReparsePoint}
                    )
                        .Length > 0 {
                        suggestion = "python3 -m unittest"
                    } else {
                        let manifest = Path.Combine(root, "package.json")
                        if File.Exists(manifest) {
                            try {
                                if J.Text(J.Get(J.Parse(File.ReadAllText(manifest)), "scripts"), "test").Trim() != "" {
                                    suggestion = "npm test"
                                }
                            } catch (error JsonException) { }
                        }
                        if suggestion == "" && File.Exists(Path.Combine(root, "Cargo.toml")) {
                            suggestion = "cargo test"
                        }
                        if suggestion == "" && File.Exists(Path.Combine(root, "go.mod")) {
                            suggestion = "go test ./..."
                        }
                        let makefile = Path.Combine(root, "Makefile")
                        if suggestion == "" && File.Exists(makefile) && Regex.IsMatch(
                            File.ReadAllText(makefile),
                            "^test\\s*:(?!=)",
                            RegexOptions.Multiline
                        ) {
                            suggestion = "make test"
                        }
                    }
                    let current = J.Get(J.Parse(J.Write(fields)), "verification")
                    let options = List[string]()
                    let kept = List[string]()
                    for command in J.Items(current) {
                        kept.Add(
                            command.GetArrayLength() == 3 && command[0].ToString() == "/bin/sh" &&
                                command[1].ToString() == "-c" ? command[2].ToString(): Terminal.Command(command)
                        )
                    }
                    if kept.Count > 0 {
                        options.Add("Keep: " + String.Join(", ", kept))
                    }
                    if suggestion != "" {
                        options.Add((kept.Count > 0 ? "Replace with: ": "Suggested: ") + suggestion)
                    }
                    options.Add("Enter a command")
                    let choice = options.Count == 1 ? 1: WizardScreen.Choose(
                        "Verification commands",
                        explanation,
                        options.ToArray(),
                        "Enter commands that check the project after coding. Example: npm test. Press Enter on a blank prompt to finish.",
                        selected: kept.Count > 0 ? 1: 0
                    )
                    if kept.Count > 0 && choice == 1 {
                        edit = ""
                        continue
                    }
                    if suggestion != "" && choice == (kept.Count > 0 ? 2: 1) {
                        commands.Add([]string{"/bin/sh", "-c", suggestion})
                    }
                    while true {
                        let command = WizardScreen.Read(
                            "Verification commands",
                            explanation +
                                "\nExamples: python3 -m unittest, npm test, cargo test, go test ./..., make test.\nEnter one shell command at a time. Enter finishes the list after at least one command.",
                            "Shell command",
                            help: "Enter commands that check the project after coding. Example: npm test. Press Enter on a blank prompt to finish."
                        )
                        if command == "" {
                            if commands.Count > 0 {
                                break
                            }
                            continue
                        }
                        commands.Add([]string{"/bin/sh", "-c", command})
                    }
                    fields["verification"] = commands
                }
                if !fields.ContainsKey("required_checks") || edit == "required-checks" {
                    let names = List[string]()
                    if fields.ContainsKey("required_checks") {
                        for item in J.Items(J.Parse(J.Write(fields["required_checks"]))) {
                            names.Add(item.GetString() ?? "")
                        }
                    }
                    let explanation = "Required checks are the GitHub CI check names that must pass on the PR."
                    let options = List[string]()
                    let runs = GitHub.Api(
                        "repos/" + repo + "/commits/" + Uri.EscapeDataString(
                            J.Text(J.Parse(J.Write(fields)), "target_branch")
                        ) +
                            "/check-runs?per_page=100&page=1"
                    )
                    for run in J.Items(J.Get(runs, "check_runs")) {
                        let name = J.Text(run, "name")
                        if name.Trim() != "" && !options.Contains(name) {
                            options.Add(name)
                        }
                    }
                    let fallback = String.Join(", ", names)
                    names.Clear()
                    if options.Count > 0 {
                        options.Add("Enter names")
                        let choice = WizardScreen.Choose(
                            "Required GitHub checks",
                            explanation,
                            options.ToArray(),
                            "Enter the exact GitHub check names that must pass before merge. Example: build, tests."
                        )
                        if choice < options.Count {
                            names.Add(options[choice - 1])
                        }
                    }
                    while names.Count == 0 {
                        let answer = WizardScreen.Read(
                            "Required GitHub checks",
                            explanation + "\nThe names are CI job names. Enter them separated by commas.",
                            "Check names",
                            fallback,
                            "Enter the exact GitHub check names that must pass before merge. Example: build, tests."
                        )
                        for name in answer.Split(',') {
                            if name.Trim() != "" {
                                names.Add(name.Trim())
                            }
                        }
                    }
                    fields["required_checks"] = names
                }
                edit = ""
                fields["model_policy"] = args.Need("model-policy")
                let value = J.Parse(J.Write(fields))
                let action = WizardScreen.Choose(
                    "Review project setup",
                    repo + "\n\n" + Report(value),
                    []string{
                        "Create policy files",
                        "Change checks, times or PR settings",
                        "Review allowed models",
                        "Change tools",
                        "Back to home"
                    },
                    "Review the project rules before Tokate writes them. Commit the files, then approve a task so donors can use the rules."
                )
                if action == 1 {
                    return
                }
                if action == 5 {
                    throw WizardHome()
                }
                if action == 2 {
                    let change = WizardScreen.Choose(
                        "Change project setup",
                        "Use checks that validate this project.",
                        []string{
                            "Verification commands",
                            "Time limit",
                            "Required GitHub checks",
                            "Target branch",
                            "Reservation time",
                            "Pull request text",
                            "Back to review"
                        },
                        "Choose which project setting to change. These settings control checks, time limits, the target branch, reservations, and pull request text."
                    )
                    if change == 1 {
                        edit = "verification"
                    }
                    if change == 2 || change == 5 {
                        let field = change == 2 ? "max_seconds": "reservation_seconds"
                        let seconds = J.Number(value, field)
                        fields[field] = int32.Parse(
                            Cli.Seconds(
                                WizardScreen.Read(
                                    change == 2 ? "Project time limit": "Reservation time",
                                    change == 2 ? "Total time for coding and verification, such as 1h or 30m.":
                                    "Time to reserve a task, such as 24h or 30m.",
                                    change == 2 ? "Maximum donor time (--max-time)": "Reservation time",
                                    seconds % 3600 == 0 ? (seconds / 3600).ToString() + "h":
                                    seconds % 60 == 0 ? (seconds / 60).ToString() + "m": seconds.ToString() + "s",
                                    change == 2 ? "Set the total time allowed for coding and verification. Example: 1h. The owner limit applies to each donor.":
                                    "Choose how long a donor may reserve a task before the reservation expires. Example: 24h."
                                ),
                                change == 2 ? "max-time": "reservation-time"
                            )
                        )
                    }
                    if change == 3 {
                        edit = "required-checks"
                    }
                    if change == 4 || change == 6 {
                        let field = change == 4 ? "target_branch": "pr_text"
                        fields[field] = WizardScreen.Read(
                            change == 4 ? "Target branch": "Pull request text",
                            change == 4 ? "Choose the branch that receives contributions.":
                            "Optional owner text appended to pull requests.",
                            change == 4 ? "Target branch (--base-branch)": "Pull request text (--pr-text)",
                            J.Text(value, field),
                            change == 4 ? "Choose the branch that receives donor changes. Use the project's main development branch, for example main.":
                            "Enter optional owner text that Tokate adds to donor pull requests. Example: Please include a test plan."
                        )
                    }
                }
                if action == 3 {
                    let mode = WizardScreen.Choose(
                        "Allowed models",
                        "Choose your model policy.",
                        []string{"Any supported model", "Choose allowed models"},
                        "Choose whether donors may use any supported model or only models you select. A whitelist gives you more control."
                    )
                    args.Values["--model-policy"] = mode == 1 ? "unrestricted": "whitelist"
                    if mode == 2 {
                        fields["models"] = RequestData.Parse(ModelChecklist().Run())
                    }
                }
                if action == 4 {
                    let choice = WizardScreen.Choose(
                        "Allowed coding tools",
                        "Owners do not need these tools installed.",
                        []string{
                            "Codex | Subscription",
                            "Claude Code | Subscription",
                            "Pi | Local",
                            "Codex, Claude Code and Pi",
                            "Edit exact harness/provider pairs"
                        },
                        "Choose which coding tools donors may use. Select exact harness/provider pairs only when you need to control those routes."
                    )
                    let pairs = List[string]()
                    for tool in J.Items(J.Get(value, "allowed_tools")) {
                        pairs.Add(J.Text(tool, "harness") + "/" + J.Text(tool, "provider"))
                    }
                    args.Values["--allowed-tools"] = choice == 5 ? Answer(
                        "Allowed harness/provider pairs",
                        String.Join(",", pairs)
                    ):
                    choice == 1 ? "codex": choice == 2 ? "claude": choice == 3 ? "pi": "codex,claude,pi"
                    Tools(args, fields)
                }
            }
        }

        internal func Run(args Args) {
            let requested = Path.GetFullPath(args.Get("path", "."))
            if !Directory.Exists(requested) {
                throw Exception(Terminal.Clean(requested) + " does not exist; pass --path to a checkout")
            }
            let root = Checkout(requested)
            let local = RepositoryInput.Local(root)
            if args.Get("repo") == "" {
                args.Values["--repo"] = local
            } else if !RepositoryIdentity.SameRepo(RepositoryIdentity.Repo(args.Get("repo")), local) {
                throw Exception(
                    Terminal.Clean(root) + " is a checkout of " + local + ", not " + args.Get("repo") +
                        "; pass --path to a checkout of " +
                        args.Get("repo")
                )
            }
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let info = GitHub.Api("repos/" + repo)
            let upstream = GitHub.FileAt(repo, ".github/tokate.json", J.Text(info, "default_branch"), missing: true)
            let path = SetupPath(root, ".github/tokate.json")
            var workflow = SetupPath(root, ".github/workflows/tokate-coordinator.yml")
            let workflows = Path.Combine(root, ".github/workflows")
            if !File.Exists(workflow) && Directory.Exists(workflows) {
                let matches = List[string]()
                for file in Directory.EnumerateFiles(workflows) {
                    if (file.EndsWith(".yml") || file.EndsWith(".yaml")) && FileInfo(file).LinkTarget == nil &&
                        File
                        .ReadAllText(file).Contains("obselate/tokate/.github/workflows/tokate-shared.yml@") {
                        matches.Add(SetupPath(root, Path.GetRelativePath(root, file)))
                    }
                }
                if matches.Count > 1 {
                    throw Exception(
                        "Multiple owner Tokate workflow entries exist; select the existing wiring before setup"
                    )
                }
                if matches.Count == 1 {
                    workflow = matches[0]
                }
            }
            let template = SetupPath(root, ".github/tokate-pr.md")
            let before = File.Exists(path) ? File.ReadAllText(path): ""
            if before != "" &&
                (upstream == "" || RequestData.Canonical(J.Parse(before)) != RequestData.Canonical(J.Parse(upstream))) {
                throw Exception(
                    Terminal.Clean(path) + " differs from the policy on " + repo + "@" + J.Text(
                        info,
                        "default_branch"
                    ) +
                        "; push or discard the local policy before running init"
                )
            }
            RepositoryAccess.RequireOwner(repo)
            let foreground = !PublicOutput.Enabled && args.Get("non-interactive") != "true" &&
                !Console.IsInputRedirected
            let permissionsPath = "repos/" + repo + "/actions/permissions/workflow"
            let permissions = GitHub.Api(permissionsPath)
            let events = CoordinatorSetup.EventPolicy(repo, Path.GetRelativePath(root, workflow), required: false)
            let pullRequests = J.Bool(permissions, "can_approve_pull_request_reviews")
            if !events || !pullRequests {
                let settings = List[string]()
                if !events {
                    settings.Add("Actions event policy allowing issue_comment, pull_request_target and workflow_call")
                }
                if !pullRequests {
                    settings.Add("Allow GitHub Actions to create and approve pull requests")
                }
                if !foreground {
                    throw Exception(
                        "Missing GitHub settings: " + String.Join(", ", settings) +
                            ". Run interactive init to confirm the changes."
                    )
                }
                let eventPolicy = map[string, Object?]{
                    "name": "Tokate coordinator events",
                    "enforcement": "active",
                    "conditions": map[string, Object?]{
                        "workflow_path": map[string, Object?]{
                            "include": []string{Path.GetRelativePath(root, workflow)},
                            "exclude": []string{}
                        }
                    },
                    "rules": []Object{
                        map[string, Object?]{
                            "type": "restrict_action_events",
                            "parameters": map[string, Object?]{
                                "allowed_events": []string{"issue_comment", "pull_request_target", "workflow_call"}
                            }
                        }
                    }
                }
                let workflowPermissions = map[string, Object?]{
                    "default_workflow_permissions": J.Text(permissions, "default_workflow_permissions"),
                    "can_approve_pull_request_reviews": true
                }
                let changes = List[string]()
                if !events {
                    changes.Add(
                        "Create the Actions policy \"Tokate coordinator events\" that allows issue_comment, pull_request_target and workflow_call for " +
                            Path.GetRelativePath(root, workflow)
                    )
                }
                if !pullRequests {
                    if J.Text(permissions, "default_workflow_permissions") != "read" && J.Text(
                        permissions,
                        "default_workflow_permissions"
                    ) != "write" {
                        throw Exception("Cannot preserve default_workflow_permissions from the GitHub Actions settings")
                    }
                    changes.Add(
                        "Allow GitHub Actions to create and approve pull requests (default workflow permissions stay " +
                            J.Text(permissions, "default_workflow_permissions") + ")"
                    )
                }
                if WizardScreen.Choose(
                    "GitHub Actions settings",
                    String.Join("\n\n", changes),
                    []string{"Apply", "Cancel"},
                    "Apply the listed GitHub settings so Tokate can coordinate project work. Choose Apply only if you want Tokate to make these changes.",
                    selected: 2
                ) != 1 {
                    throw OperationCanceledException("GitHub settings were not changed")
                }
                if !events {
                    GitHub.Api("repos/" + repo + "/actions/policies", eventPolicy, method: "POST")
                }
                if !pullRequests {
                    GitHub.Api(permissionsPath, workflowPermissions, method: "PUT")
                }
            }
            var existing Policy? = nil
            let fields = map[string, Object?]{}
            if upstream != "" {
                existing = Policy(upstream)
                for field in existing.Value.EnumerateObject() {
                    fields[field.Name] = field.Value
                }
            } else {
                fields["version"] = 2
                fields["approval_scope"] = "task"
                fields["eligibility"] = "trusted"
                fields["allowed_tools"] = []Object{map[string, Object?]{"harness": "codex", "provider": "openai"}}
                fields["max_seconds"] = 3600
            }
            let mode = args.Get("model-policy", existing?.ModelPolicy ?? "")
            if mode != "" && (existing == nil || args.Get("model-policy") != "") {
                fields["model_policy"] = mode
            }
            if args.Get("models") != "" {
                fields["models"] = RequestData.Parse(args.Get("models"))
            }
            Tools(args, fields)
            let value = J.Parse(J.Write(fields))
            for key in[]string{
                "eligibility",
                "base-branch",
                "seconds",
                "reservation-seconds",
                "verification",
                "required-checks",
                "pr-text",
                "close-message"
            } {
                let field = key == "base-branch" ? "target_branch": key == "seconds" ? "max_seconds":
                key.Replace('-', '_')
                let present = J.Get(value, field)
                var fallback = present.ValueKind == JsonValueKind.Undefined ? "": present.ToString()
                if foreground && fallback == "" && key == "base-branch" {
                    fallback = J.Text(info, "default_branch")
                }
                if foreground && fallback == "" && key == "reservation-seconds" {
                    fallback = "86400"
                }
                let answer = args.Get(key, fallback)
                if answer == "" {
                    continue
                }
                if key == "seconds" || key == "reservation-seconds" {
                    fields[field] = Int32.Parse(answer)
                } else if key == "verification" || key == "required-checks" {
                    fields[field] = RequestData.Parse(answer)
                } else {
                    fields[field] = answer
                }
            }
            if foreground {
                Guide(args, fields, root)
                fields["model_policy"] = args.Need("model-policy")
            }
            let selected = args.Get("model-policy", existing?.ModelPolicy ?? "")
            if selected != "unrestricted" && selected != "whitelist" {
                throw Exception(
                    "Choose --model-policy unrestricted or whitelist; no model restriction is selected silently"
                )
            }
            if selected == "unrestricted" {
                if args.Get("models") != "" {
                    throw Exception("Unrestricted models excludes --models")
                }
                fields.Remove("models")
            } else if !fields.ContainsKey("models") {
                throw Exception("Whitelist setup requires --models JSON")
            }
            let candidate = J.Write(fields)
            let policy = Policy(candidate)
            let text = before != "" && RequestData.Canonical(J.Parse(before)) == RequestData.Canonical(
                policy.Value
            ) ? before: Pretty(policy.Value)
            let oldWorkflow = File.Exists(workflow) ? File.ReadAllText(workflow): ""
            let yaml = oldWorkflow == "" ? CoordinatorSetup.Resolve(): oldWorkflow
            var protectionNote = ""
            try {
                let branch = J.Text(policy.Value, "target_branch")
                let protectionPath = "repos/" + repo + "/branches/" + Uri.EscapeDataString(branch) + "/protection"
                let protection = GitHub.Api(protectionPath, missing: true)
                let statusChecks = J.Get(protection, "required_status_checks")
                let required = HashSet[string](StringComparer.Ordinal)
                for check in J.Items(J.Get(statusChecks, "checks")) {
                    required.Add(J.Text(check, "context"))
                }
                for context in J.Items(J.Get(statusChecks, "contexts")) {
                    required.Add(context.GetString() ?? "")
                }
                let missing = List[string]()
                for check in J.Items(J.Get(policy.Value, "required_checks")) {
                    let name = check.GetString() ?? ""
                    if required.Add(name) {
                        missing.Add(name)
                    }
                }
                if missing.Count > 0 {
                    let names = String.Join(", ", missing)
                    if !foreground ||
                        (
                        protection.ValueKind != JsonValueKind.Undefined &&
                            statusChecks.ValueKind != JsonValueKind.Object
                    ) {
                        protectionNote = "Add " +
                            names +
                            " as required checks in GitHub Settings > Branches > " +
                            branch +
                            "."
                    } else if WizardScreen.Choose(
                        "GitHub branch protection",
                        "Require checks on " + branch + ": " + names + ". No other protection changes.",
                        []string{"Apply", "Skip"},
                        selected: 2
                    ) == 1 {
                        if protection.ValueKind == JsonValueKind.Undefined {
                            GitHub.Api(
                                protectionPath,
                                map[string, Object?]{
                                    "required_status_checks": map[string, Object?]{
                                        "strict": false,
                                        "contexts": missing
                                    },
                                    "enforce_admins": false,
                                    "required_pull_request_reviews": nil,
                                    "restrictions": nil
                                },
                                method: "PUT"
                            )
                        } else {
                            GitHub.Api(
                                protectionPath + "/required_status_checks/contexts",
                                map[string, Object?]{"contexts": missing},
                                method: "POST"
                            )
                        }
                    }
                }
            } catch (error OperationCanceledException) {
                throw error
            } catch (error WizardHome) {
                throw error
            } catch (error Exception) {
                protectionNote = "GitHub branch protection: " + Terminal.Clean(error.Message)
            }
            WizardScreen.Close()
            if protectionNote != "" && !PublicOutput.Enabled {
                Terminal.Message(protectionNote)
            }
            SetupPath(root, ".github/tokate.json")
            SetupPath(root, Path.GetRelativePath(root, workflow))
            if before != text {
                Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)
                File.WriteAllText(path, text)
            }
            if oldWorkflow == "" {
                Directory.CreateDirectory(Path.GetDirectoryName(workflow) ?? root)
                File.WriteAllText(workflow, yaml)
            }
            if File.ReadAllText(path) != text || File.ReadAllText(workflow) != yaml {
                throw Exception("Setup output differs from the generated configuration")
            }
            Console.Error.WriteLine(
                (before == "" ? "Added ": before == text ? "Unchanged ": "Updated ") + Terminal.Clean(path)
            )
            if before != text && !PublicOutput.Enabled {
                Terminal.Message(Report(policy.Value, before), error: true)
            }
            Console.Error.WriteLine((oldWorkflow == "" ? "Added ": "Unchanged ") + Terminal.Clean(workflow))
            if File.Exists(template) {
                Console.Error.WriteLine("Unchanged " + Terminal.Clean(template))
            }
            Terminal.Message(
                "Owner footprint: " +
                    (File.Exists(template) ? "3": "2") +
                    " files; no copied runtime code, dependency files or test scaffolding are generated.",
                "cyan",
                true
            )
            Terminal.Message(
                oldWorkflow == "" ? "Workflow permissions: contents write for coordination refs, issues read for canonical requests, pull-requests write for draft publication; no secrets inheritance or checkout.": "Existing owner workflow is preserved. Review wiring and permissions against a pinned workflow: tokate coordinator-setup " +
                    repo +
                    " --output tokate-coordinator.yml.",
                "cyan",
                true
            )
            Terminal.Message(
                "Generated state: one tokate/access ref for numeric membership, one tokate/contributions/N ref per issue, and explicit synchronization grant refs. Setup creates no refs; initialize access before task approval.",
                "cyan",
                true
            )
            let changed = before != text || oldWorkflow == ""
            if upstream != "" && RequestData.Canonical(J.Parse(upstream)) != RequestData.Canonical(policy.Value) {
                Terminal.Message(
                    "Policy changes stale all existing approvals and claims; the owner must approve again. Eligibility revocation separately blocks new work and publication immediately.",
                    "yellow",
                    true
                )
            }
            Terminal.Message(
                changed ? "Owner setup written. Commit and push the policy and workflow before approving work; every PR still needs owner review.": "Owner setup already matches; nothing to commit."
            )
            PublicOutput.ResultData = map[string, Object?]{
                "applied": changed,
                "file_count": File.Exists(template) ? 3: 2,
                "policy_changed": before != text,
                "workflow_changed": oldWorkflow == "",
                "model_policy": policy.ModelPolicy
            }
        }

        private func Pretty(value JsonElement) string {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes, JsonWriterOptions{Indented: true})
            value.WriteTo(writer)
            writer.Flush()
            return System.Text.Encoding.UTF8.GetString(bytes.ToArray()) + "\n"
        }
    }
}
