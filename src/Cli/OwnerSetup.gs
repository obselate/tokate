package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class OwnerSetup {
    shared {
        private func Unattended(args Args) bool -> PublicOutput.Enabled || args.Get("json") == "true" || args.Get(
            "non-interactive"
        ) == "true" ||
            Console.IsInputRedirected ||
            Console.IsOutputRedirected ||
            Console.IsErrorRedirected

        internal func Confirm(args Args, prompt string = "Apply these changes?") bool {
            if args.Get("yes") == "true" {
                return true
            }

            if Unattended(args) {
                Terminal.Message("Preview only; use --yes to apply these changes.", "cyan", true)
                return false
            }

            Console.Error.Write(Terminal.Clean(prompt) + " [y/N]: ")
            return String.Equals(Console.ReadLine(), "y", StringComparison.OrdinalIgnoreCase)
        }

        private func Change(changes List[Object], name string, old string, next string) {
            changes.Add(map[string, Object?]{"change": name, "old": old, "new": next})
            Console.Error.WriteLine(
                Terminal.Clean(name + "\n  Current: " + (old == "" ? "none": old) + "\n  Proposed: " + next)
            )
        }

        private func Tools(requested string) Object {
            if requested.TrimStart().StartsWith("[", StringComparison.Ordinal) {
                return RequestData.Parse(requested)
            }

            let tools = List[Object]()
            for name in requested.Split(',') {
                let parts = name.Trim().Split('/')
                let provider = parts.Length == 2 ? parts[1]: Harness.DefaultProvider(parts[0])

                if parts.Length > 2 || !Regex.IsMatch(parts[0], "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\\z") ||
                    !Regex
                    .IsMatch(provider, "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\\z") {
                    throw Exception("Use codex, claude, pi, or exact harness/provider pairs for allowed tools")
                }

                tools.Add(map[string, Object?]{"harness": parts[0], "provider": provider})
            }

            return tools
        }

        private func Fields(upstream string) Dictionary[string, Object?] {
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
            } else {
                fields["version"] = 3
                fields["approval_scope"] = "task"
                fields["eligibility"] = "trusted"
                fields["allowed_tools"] = Tools("codex,claude,pi")
                fields["max_seconds"] = 3600
            }

            return fields
        }

        private func Options(args Args, fields Dictionary[string, Object?]) {
            if args.Get("allowed-tools") != "" {
                fields["allowed_tools"] = Tools(args.Get("allowed-tools"))
            }

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
                let answer = args.Get(key)

                if answer == "" {
                    if !fields.ContainsKey(field) && (key == "verification" || key == "required-checks") {
                        args.Need(key)
                    }
                } else if key == "seconds" || key == "reservation-seconds" {
                    fields[field] = Int32.Parse(answer)
                } else if key == "verification" || key == "required-checks" {
                    fields[field] = RequestData.Parse(answer)
                } else {
                    fields[field] = answer
                }
            }
        }

        internal func Run(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let owner = GitHub.Author(GitHub.Api("user"))
            let info = GitHub.Api("repos/" + repo)
            if !J.Bool(J.Get(info, "permissions"), "admin") {
                throw Exception("Repository admin permission is required for owner setup")
            }

            let main = J.Text(info, "default_branch")
            let head = GitHub.Branch(repo, main)
            let upstream = GitHub.FileAt(repo, ".github/tokate.json", head, missing: true)
            let fields = Fields(upstream)
            let existing Policy? = upstream == "" ? nil: Policy(J.Write(fields))
            Options(args, fields)
            let policy = Policy(J.Write(fields))
            let text = upstream != "" && RequestData.Canonical(J.Parse(upstream)) == RequestData.Canonical(
                policy.Value
            ) ? upstream: Pretty(policy.Value)
            let path = ".github/workflows/tokate-coordinator.yml"
            let current = GitHub.FileAt(repo, path, head, missing: true)
            let generated = CoordinatorSetup.Resolve()
            let pin = CoordinatorSetup.Pin(generated)
            let oldPin = CoordinatorSetup.Pin(current)
            let workflow = oldPin == pin ? current: generated
            let shared = "obselate/tokate/.github/workflows/tokate-shared.yml@" + pin
            let changes = List[Object]()
            let manual = List[string]()

            let actions = GitHub.Api("repos/" + repo + "/actions/permissions")
            if !J.Bool(actions, "enabled") {
                throw Exception(
                    "Actions is disabled. Enable Actions in Settings > Actions > General, then run init again"
                )
            }

            let allowed = J.Text(actions, "allowed_actions")
            let allowlist = CoordinatorSetup.Allowlist(repo, allowed, shared)
            let patterns = List[string](allowlist.Patterns)
            patterns.Add(shared)
            let extend = allowed == "selected" && !allowlist.Permitted && !allowlist.Blocked
            if extend {
                Change(
                    changes,
                    "Actions allowed workflows",
                    String.Join(", ", allowlist.Patterns),
                    String.Join(", ", patterns)
                )
            } else if !allowlist.Permitted {
                manual.Add(
                    "In " + repo + " > Settings > Actions > General > Actions permissions, allow " + shared + "."
                )
            }

            let permissionsPath = "repos/" + repo + "/actions/permissions/workflow"
            let permissions = GitHub.Api(permissionsPath)
            let pullRequests = J.Bool(permissions, "can_approve_pull_request_reviews")
            if !pullRequests {
                if J.Text(permissions, "default_workflow_permissions") != "read" && J.Text(
                    permissions,
                    "default_workflow_permissions"
                ) != "write" {
                    throw Exception("Cannot preserve default_workflow_permissions from the GitHub Actions settings")
                }
                Change(changes, "Allow GitHub Actions to create and approve pull requests", "no", "yes")
            }

            let events = CoordinatorSetup.EventPolicy(repo, path)
            if !events {
                Change(
                    changes,
                    "Actions event policy Tokate coordinator events",
                    "",
                    "allow issues, issue_comment, pull_request_target and workflow_call for " + path
                )
            }

            let branch = J.Text(policy.Value, "target_branch") == "" ? main: J.Text(policy.Value, "target_branch")
            let protectionPath = "repos/" + repo + "/branches/" + Uri.EscapeDataString(branch) + "/protection"
            var protection JsonElement
            let missing = List[string]()
            try {
                protection = GitHub.Api(protectionPath, missing: true)
                let statusChecks = J.Get(protection, "required_status_checks")
                let required = List[string]()
                for check in J.Items(J.Get(statusChecks, "checks")) {
                    required.Add(J.Text(check, "context"))
                }
                for context in J.Items(J.Get(statusChecks, "contexts")) {
                    required.Add(context.GetString() ?? "")
                }
                for check in J.Items(J.Get(policy.Value, "required_checks")) {
                    let name = check.GetString() ?? ""
                    if !required.Contains(name) && !missing.Contains(name) {
                        missing.Add(name)
                    }
                }
                if missing.Count > 0 &&
                    protection.ValueKind != JsonValueKind.Undefined &&
                    statusChecks.ValueKind != JsonValueKind
                    .Object {
                    manual.Add(
                        "In GitHub Settings > Branches > " + branch + ", require " + String.Join(", ", missing) + "."
                    )
                    missing.Clear()
                }
                if missing.Count > 0 {
                    let after = List[string](required)
                    after.AddRange(missing)
                    Change(
                        changes,
                        "Required checks on " + branch,
                        String.Join(", ", required),
                        String.Join(", ", after)
                    )
                }
            } catch (error Exception) {
                manual.Add(
                    "GitHub branch protection could not be read: " +
                        error.Message +
                        " Require the policy checks on " +
                        branch +
                        "."
                )
            }

            let access = AccessState.Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")), missing: true)
            if access.Sha == "" {
                Change(changes, "Branch tokate/access", "", "empty donor access record")
            }

            let files = List[Object]()
            if text != upstream {
                files.Add(
                    map[string, Object?]{
                        "path": ".github/tokate.json",
                        "mode": "100644",
                        "type": "blob",
                        "content": text
                    }
                )
            }
            if workflow != current {
                files.Add(map[string, Object?]{"path": path, "mode": "100644", "type": "blob", "content": workflow})
            }

            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/tokate-setup", missing: true)
            let setup = J.Text(J.Get(reference, "object"), "sha")
            let pulls = GitHub.Api(
                "repos/" + repo + "/pulls?state=open&per_page=1&head=" + Uri.EscapeDataString(
                    repo.Split('/')[0] + ":tokate-setup"
                )
            )
            var pull = pulls.ValueKind == JsonValueKind.Array && pulls.GetArrayLength() > 0 ? J.Text(
                pulls[0],
                "html_url"
            ): ""
            let rebuild = files.Count > 0 && !Prepared(repo, setup, head, files)
            if rebuild && text != upstream {
                Change(changes, ".github/tokate.json", upstream, text)
            }
            if rebuild && workflow != current {
                Change(changes, path, current, workflow)
                if oldPin != "" {
                    Console.Error.WriteLine(
                        "Compare shared workflows: https://github.com/obselate/tokate/compare/" + oldPin + "..." + pin
                    )
                }
            }
            if rebuild {
                Change(
                    changes,
                    "Branch tokate-setup",
                    setup,
                    "new commit on " + main + " at " + head + " with the files above"
                )
            }
            if files.Count > 0 && pull == "" {
                Change(changes, "Setup PR", "", "Set up Tokate, from tokate-setup into " + main)
            }

            let affected = ApprovalImpact(repo, upstream, policy)
            let result = map[string, Object?]{
                "repo": repo,
                "applied": false,
                "changes": changes,
                "manual": manual,
                "task_fields_changed": existing != nil && existing.Digest != policy.Digest,
                "approvals_to_renew": affected
            }
            if files.Count > 0 && pull != "" {
                result["pull_request"] = pull
            }
            PublicOutput.ResultData = result
            Terminal.Message(
                "Tokate keeps its state in the tokate/access and tokate/contributions/N branches. Do not delete them or open pull requests from them.",
                "cyan",
                true
            )
            for step in manual {
                Terminal.Message("Manual: " + step, "yellow", true)
            }
            if affected.Count > 0 {
                Terminal.Message(
                    "Re-approve these issues" + (files.Count > 0 ? " after the setup PR is merged:": ":"),
                    "yellow",
                    true
                )
                for issue in affected {
                    Terminal.Message("tokate approve " + repo + "#" + issue.ToString(), "yellow", true)
                }
            }

            if changes.Count == 0 {
                Terminal.Message(
                    manual.Count > 0 ? "Complete the manual steps above.": files.Count > 0 ? "Nothing to change. Review and merge the setup PR " +
                        pull +
                        ".": "Owner setup already matches. Nothing to change."
                )
                return
            }

            if !Confirm(args, "Apply this setup?") {
                if Unattended(args) {
                    return
                }
                throw CliFailure("confirmation_required", "Pass --yes to apply the previewed setup. Nothing changed.")
            }

            if extend {
                GitHub.Api(
                    "repos/" + repo + "/actions/permissions/selected-actions",
                    map[string, Object?]{
                        "github_owned_allowed": J.Get(allowlist.Selected, "github_owned_allowed"),
                        "verified_allowed": J.Get(allowlist.Selected, "verified_allowed"),
                        "patterns_allowed": patterns
                    },
                    method: "PUT"
                )
            }
            if !pullRequests {
                GitHub.Api(
                    permissionsPath,
                    map[string, Object?]{
                        "default_workflow_permissions": J.Text(permissions, "default_workflow_permissions"),
                        "can_approve_pull_request_reviews": true
                    },
                    method: "PUT"
                )
            }
            if !events {
                GitHub.Api(
                    "repos/" + repo + "/actions/policies",
                    map[string, Object?]{
                        "name": "Tokate coordinator events",
                        "enforcement": "active",
                        "conditions": map[string, Object?]{
                            "workflow_path": map[string, Object?]{"include": []string{path}, "exclude": []string{}}
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
                    },
                    method: "POST"
                )
            }
            if missing.Count > 0 && protection.ValueKind == JsonValueKind.Undefined {
                GitHub.Api(
                    protectionPath,
                    map[string, Object?]{
                        "required_status_checks": map[string, Object?]{"strict": false, "contexts": missing},
                        "enforce_admins": false,
                        "required_pull_request_reviews": nil,
                        "restrictions": nil
                    },
                    method: "PUT"
                )
            } else if missing.Count > 0 {
                GitHub.Api(
                    protectionPath + "/required_status_checks/contexts",
                    map[string, Object?]{"contexts": missing},
                    method: "POST"
                )
            }
            if access.Sha == "" {
                access.Write(repo, head, owner)
            }
            if rebuild {
                let base = GitHub.Api("repos/" + repo + "/git/commits/" + head)
                let tree = GitHub.Api(
                    "repos/" + repo + "/git/trees",
                    map[string, Object?]{"base_tree": J.Text(J.Get(base, "tree"), "sha"), "tree": files}
                )
                let commit = GitHub.Api(
                    "repos/" + repo + "/git/commits",
                    GitHub.AutomationCommit(
                        "Set up Tokate",
                        J.Text(tree, "sha"),
                        setup == "" ? []string{head}: []string{setup, head},
                        owner
                    )
                )
                let next = RepositoryIdentity.CommitSha(J.Text(commit, "sha"))
                if setup == "" {
                    GitHub.Api(
                        "repos/" + repo + "/git/refs",
                        map[string, Object?]{"ref": "refs/heads/tokate-setup", "sha": next}
                    )
                } else {
                    GitHub.Api(
                        "repos/" + repo + "/git/refs/heads/tokate-setup",
                        map[string, Object?]{"sha": next, "force": false},
                        "PATCH"
                    )
                }
            }
            if files.Count > 0 && pull == "" {
                pull = J.Text(
                    GitHub.Api(
                        "repos/" + repo + "/pulls",
                        map[string, Object?]{
                            "title": "Set up Tokate",
                            "head": repo.Split('/')[0] + ":tokate-setup",
                            "base": main,
                            "body": "Tokate owner setup: policy and pinned coordinator workflow. Merge to finish setup."
                        }
                    ),
                    "html_url"
                )
            }
            if pull != "" {
                result["pull_request"] = pull
            }
            result["applied"] = true
            Terminal.Message(
                files.Count > 0 ? "Setup PR " +
                    pull +
                    ". Review and merge it before approving work.": "Owner setup applied."
            )
        }

        private func Prepared(repo string, setup string, head string, files List[Object]) bool {
            if setup == "" {
                return false
            }

            let commit = GitHub.Api("repos/" + repo + "/git/commits/" + setup)
            if !J.Items(J.Get(commit, "parents")).Exists(parent -> J.Text(parent, "sha") == head) {
                return false
            }

            for file in J.Items(J.Parse(J.Write(files))) {
                if GitHub.FileAt(repo, J.Text(file, "path"), setup, missing: true).TrimEnd() != J.Text(file, "content")
                    .TrimEnd() {
                    return false
                }
            }

            return true
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
