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

            Terminal.Message("Preview only; use --yes to apply these changes.", "cyan", true)
            return false
        }

        private func Report(value JsonElement, before string = "") string {
            let previous = before == "" ? default(JsonElement): J.Parse(before)
            let rows = List[string]()

            for field in[]string{
                "eligibility",
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

                if field == "close_message" && item.ValueKind == JsonValueKind.Undefined {
                    continue
                }

                let old = J.Get(previous, field)

                if before != "" && RequestData.Same(item, old) {
                    continue
                }

                let label = switch field {
                    case "eligibility": "Access   "
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
                            let models = J.Get(entry, "models")
                            let allowed = List[string]()
                            if models.ValueKind == JsonValueKind.Object {
                                for model in models.EnumerateObject() {
                                    let efforts = List[string]()
                                    for effort in J.Items(model.Value) {
                                        efforts.Add(effort.GetString() ?? "")
                                    }

                                    allowed.Add(model.Name + " / " + String.Join(", ", efforts))
                                }
                            }

                            items.Add(
                                (
                                    switch J.Text(entry, "harness") {
                                        case "codex": "Codex (Subscription)"
                                        case "claude": "Claude Code (Subscription)"
                                        case "pi": "Pi (Local)"
                                        case "omp": "OMP (" + J.Text(entry, "provider") + ")"
                                        default: J.Text(entry, "harness") + " (" + J.Text(entry, "provider") + ")"
                                    }
                                ) +
                                    ": " +
                                    (
                                    models.ValueKind == JsonValueKind.Undefined ? "any model": String.Join(
                                        ", ",
                                        allowed
                                    )
                                )
                            )
                        }
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

            if requested.TrimStart().StartsWith("[", StringComparison.Ordinal) {
                fields["allowed_tools"] = RequestData.Parse(requested)
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
                    var pair = J.Parse(J.Write(map[string, Object?]{"harness": harness, "provider": provider}))
                    for tool in J.Items(J.Get(value, "allowed_tools")) {
                        if J.Text(tool, "harness") == harness && J.Text(tool, "provider") == provider {
                            pair = tool
                            break
                        }
                    }

                    tools.Add(pair)
                }
            }

            fields["allowed_tools"] = tools
        }

        private func SetModels(fields map[string, Object?], mode string, models JsonElement, selected int32 = -1) {
            let tools = List[Object]()
            let entries = J.Items(J.Get(J.Parse(J.Write(fields)), "allowed_tools"))
            for i in 0 ... entries.Count {
                let pair = map[string, Object?]{}
                for field in entries[i].EnumerateObject() {
                    if field.Name != "models" || (selected >= 0 && i != selected) {
                        pair[field.Name] = field.Value
                    }
                }

                if (selected < 0 || i == selected) && mode == "whitelist" {
                    pair["models"] = models
                }

                tools.Add(pair)
            }

            fields["allowed_tools"] = tools
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

            let oldWorkflow = File.Exists(workflow) ? File.ReadAllText(workflow): ""
            let yaml = oldWorkflow == "" ? CoordinatorSetup.Resolve(): oldWorkflow
            let uses = Regex.Matches(
                yaml,
                "(?m)^\\s*uses:\\s*['\"]?obselate/tokate/\\.github/workflows/tokate-shared\\.yml@([0-9a-f]{40})['\"]?\\s*$"
            )
            let problems = List[string]()
            for check in OwnerHealth().InspectActions(repo, uses.Count == 1 ? uses[0].Groups[1].Value: "") {
                let row = check as Dictionary[string, Object?]
                if row != nil && row["status"] as string == "problem" {
                    problems.Add(row["message"] as string ?? "")
                }
            }
            let notice = String.Join("\n\n", problems)
            if notice != "" {
                Terminal.Message(notice, "yellow", true)
            }
            var existing Policy? = nil
            let fields = map[string, Object?]{}

            if upstream != "" {
                let legacy = RequestData.Parse(upstream, 1024 * 1024)
                for field in legacy.EnumerateObject() {
                    fields[field.Name] = field.Value
                }

                if J.Number(legacy, "version") == 2 {
                    let mode = J.Text(legacy, "model_policy")
                    if J.Get(legacy, "model_policy")
                        .ValueKind != JsonValueKind.Undefined &&
                        (
                        J.Get(legacy, "model_policy")
                            .ValueKind != JsonValueKind.String ||
                            (mode != "whitelist" && mode != "unrestricted")
                    ) {
                        throw Exception("Invalid version 2 model policy")
                    }

                    let models = J.Get(legacy, "models")
                    if mode == "unrestricted" &&
                        models.ValueKind != JsonValueKind.Undefined &&
                        (models.ValueKind != JsonValueKind.Object || models.EnumerateObject().MoveNext()) {
                        throw Exception("Unrestricted model policy requires omitted models or an empty object")
                    }

                    let tools = List[Object]()
                    for tool in J.Items(J.Get(legacy, "allowed_tools")) {
                        let pair = J.Select(tool, "harness,provider")
                        if mode != "unrestricted" {
                            pair["models"] = models
                        }
                        tools.Add(pair)
                    }

                    fields.Remove("models")
                    fields.Remove("model_policy")
                    fields["version"] = 3
                    fields["allowed_tools"] = tools
                    if J.Text(legacy, "eligibility") == "manual" {
                        fields["eligibility"] = "trusted"
                    }
                }

                existing = Policy(J.Write(fields))
            } else {
                fields["version"] = 3
                fields["approval_scope"] = "task"
                fields["eligibility"] = "trusted"
                fields["allowed_tools"] = []Object{map[string, Object?]{"harness": "codex", "provider": "openai"}}
                fields["max_seconds"] = 3600
            }

            Tools(args, fields)

            let mode = args.Get("model-policy")
            if mode != "" && mode != "unrestricted" && mode != "whitelist" {
                throw Exception("Choose --model-policy unrestricted or whitelist")
            }

            if mode == "unrestricted" && args.Get("models") != "" {
                throw Exception("Unrestricted models excludes --models")
            }

            if args.Get("models") != "" && mode != "whitelist" {
                throw CliFailure("invalid_arguments", "Whitelist setup requires --model-policy whitelist")
            }

            if mode == "unrestricted" || args.Get("models") != "" {
                SetModels(fields, mode, mode == "unrestricted" ? JsonElement{}: RequestData.Parse(args.Get("models")))
            }

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

            if mode == "whitelist" && args.Get("models") == "" {
                throw CliFailure("invalid_arguments", "Whitelist setup requires --models JSON")
            } else if existing == nil &&
                mode == "" &&
                !args
                .Get("allowed-tools")
                .TrimStart()
                .StartsWith("[", StringComparison.Ordinal) {
                throw CliFailure(
                    "invalid_arguments",
                    "Choose --model-policy unrestricted or whitelist, or per-tool --allowed-tools JSON"
                )
            }

            for key in[]string{"verification", "required-checks"} {
                if !fields.ContainsKey(key.Replace('-', '_')) {
                    args.Need(key)
                }
            }

            let candidate = J.Write(fields)
            let policy = Policy(candidate)
            let permissionsPath = "repos/" + repo + "/actions/permissions/workflow"
            let permissions = GitHub.Api(permissionsPath)
            let events = CoordinatorSetup.EventPolicy(repo, Path.GetRelativePath(root, workflow), required: false)
            let pullRequests = J.Bool(permissions, "can_approve_pull_request_reviews")

            if !events || !pullRequests {
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
                                "allowed_events": []string{
                                    "issues",
                                    "issue_comment",
                                    "pull_request_target",
                                    "workflow_call"
                                }
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
                        "Create the Actions policy \"Tokate coordinator events\" that allows issues, issue_comment, pull_request_target and workflow_call for " +
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

                Terminal.Message(
                    String.Join("\n", changes) +
                        (args.Get("yes") == "true" ? "": "\nPreview only. Pass --yes to apply GitHub settings."),
                    error: true
                )

                if args.Get("yes") != "true" {
                    throw CliFailure(
                        "invalid_arguments",
                        "Missing GitHub settings. Pass --yes to apply the previewed changes."
                    )
                }

                if !events {
                    GitHub.Api("repos/" + repo + "/actions/policies", eventPolicy, method: "POST")
                }

                if !pullRequests {
                    GitHub.Api(permissionsPath, workflowPermissions, method: "PUT")
                }
            }

            let text = before != "" && RequestData.Canonical(J.Parse(before)) == RequestData.Canonical(
                policy.Value
            ) ? before: Pretty(policy.Value)

            var protectionNote = ""
            try {
                let branch = J.Text(policy.Value, "target_branch") == "" ? J.Text(info, "default_branch"): J.Text(
                    policy.Value,
                    "target_branch"
                )
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

                    if args.Get("yes") != "true" ||
                        (
                        protection.ValueKind != JsonValueKind.Undefined &&
                            statusChecks.ValueKind != JsonValueKind.Object
                    ) {
                        protectionNote = "Add " +
                            names +
                            " as required checks with --yes in GitHub Settings > Branches > " +
                            branch +
                            "."
                    } else {
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
            } catch (error Exception) {
                protectionNote = "GitHub branch protection: " + Terminal.Clean(error.Message)
            }

            if protectionNote != "" {
                Terminal.Message(protectionNote, error: true)
            }

            let affected = ApprovalImpact(repo, upstream, policy)
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
                oldWorkflow == "" ? "Workflow permissions: contents write for coordination refs, issues write for label approval and canonical requests, pull-requests write for draft publication; no secrets inheritance or checkout.": "Existing owner workflow is preserved. Review wiring and permissions against a pinned workflow: tokate coordinator-setup " +
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
            let taskChanged = existing != nil && existing.Digest != policy.Digest
            if taskChanged {
                Terminal.Message("Task fields changed.", "yellow", true)
            }

            if affected.Count > 0 {
                Terminal.Message(
                    "Re-approve these issues after the policy change is merged: " + String.Join(", ", affected),
                    "yellow",
                    true
                )

                for issue in affected {
                    Terminal.Message("tokate approve " + repo + "#" + issue.ToString(), "yellow", true)
                }
            } else if upstream != "" {
                Terminal.Message("Approvals stay valid.", "cyan", true)
            }

            Terminal.Message(
                changed ? "Owner setup written. Commit and push the policy and workflow before approving work; every PR still needs owner review.": "Owner setup already matches; nothing to commit."
            )
            PublicOutput.ResultData = map[string, Object?]{
                "applied": changed,
                "file_count": File.Exists(template) ? 3: 2,
                "policy_changed": before != text,
                "workflow_changed": oldWorkflow == "",
                "task_fields_changed": taskChanged,
                "approvals_to_renew": affected
            }
        }

        private func ApprovalImpact(repo string, upstream string, policy Policy) List[int32] {
            let affected = List[int32]()
            if upstream == "" {
                return affected
            }

            var page = 1
            while true {
                let issues = GitHub.Api(
                    "repos/" + repo + "/issues?state=open&labels=tokate%3Aapproved&per_page=100&page=" + page.ToString()
                )
                if issues.ValueKind != JsonValueKind.Array {
                    throw Exception("Cannot list approved issues before policy setup")
                }

                for issue in J.Items(issues) {
                    if J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined || !GitHub.HasLabel(issue) {
                        continue
                    }

                    let number = J.Number(issue, "number")
                    let state = CoordinationState.Load(repo, number, true).Value()
                    let approval = J.Get(state, "approval")
                    if !J.Bool(state, "revoked") && approval.ValueKind == JsonValueKind.Object && J.Text(
                        approval,
                        "policy_hash"
                    ) != policy.Digest {
                        affected.Add(number)
                    }
                }

                if issues.GetArrayLength() < 100 {
                    break
                }

                page++
            }

            affected.Sort()
            return affected
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
