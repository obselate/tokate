package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class OwnerSetup {
    shared {
        private const DefaultBudgetSeconds int32 = 3600

        internal const CoordinatorWorkflowPath string = ".github/workflows/tokate-coordinator.yml"

        private const SetupBranchName string = "tokate-setup"

        internal func Unattended(args Args) bool -> PublicOutput.Enabled || args.Get("json") == "true" || args.Get(
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

            Console.Error.Write(Output.Clean(prompt) + " [y/N]: ")
            return String.Equals(Console.ReadLine(), "y", StringComparison.OrdinalIgnoreCase)
        }

        private func Change(changes List[Object], name string, old string, next string) {
            changes.Add(map[string, Object?]{"change": name, "old": old, "new": next})
            Console.Error.WriteLine(
                Output.Clean(name + "\n  Current: " + (old == "" ? "none": old) + "\n  Proposed: " + next)
            )
        }

        private func Tools(requested string) Object {
            if requested.TrimStart().StartsWith("[", StringComparison.Ordinal) {
                return RequestData.Parse(requested, RequestData.RequestByteLimit)
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
                let value = RequestData.Parse(upstream, Policy.FileByteLimit)
                for field in value.EnumerateObject() {
                    fields[field.Name] = field.Value
                }
            } else {
                fields["version"] = 3
                fields["approval_scope"] = "task"
                fields["eligibility"] = "trusted"
                fields["allowed_tools"] = Tools("codex,claude,pi")
                fields["max_seconds"] = DefaultBudgetSeconds
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
                    continue
                } else if key == "seconds" || key == "reservation-seconds" {
                    fields[field] = Int32.Parse(answer)
                } else if key == "verification" || key == "required-checks" {
                    fields[field] = RequestData.Parse(answer, RequestData.RequestByteLimit)
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
            let upstream = GitHub.FileAt(repo, Policy.FilePath, head, missing: true)
            let fields = Fields(upstream)
            let existing Policy? = upstream == "" ? nil: Policy(J.Write(fields))

            Options(args, fields)

            let policy = Policy(J.Write(fields))
            let text = upstream != "" && RequestData.Canonical(J.Parse(upstream)) == RequestData.Canonical(
                policy.Value
            ) ? upstream: Pretty(policy.Value)

            let path = CoordinatorWorkflowPath
            let current = GitHub.FileAt(repo, path, head, missing: true)
            let generated = CoordinatorSetup.Resolve(args.Get("pin") == "true")
            let pin = CoordinatorSetup.Pin(generated)
            let oldPin = CoordinatorSetup.Pin(current)
            let workflow = current.Replace("\r", "").TrimEnd() == generated.TrimEnd() ? current: generated
            let shared = "obselate/tokate/.github/workflows/tokate-shared.yml@" + pin
            let changes = List[Object]()
            let manual = List[string]()

            let actions = ReadActions(repo)

            let allowed = J.Text(actions, "allowed_actions")
            let allowlist = CoordinatorSetup.Allowlist(repo, allowed, shared)
            let patterns = List[string](allowlist.Patterns)
            patterns.Add(shared)
            let extend = allowed == "selected" && !allowlist.Permitted && !allowlist.Blocked

            PreviewAllowlist(repo, shared, changes, manual, allowlist, patterns, extend)

            let permissionsPath = "repos/" + repo + "/actions/permissions/workflow"
            let permissions = PreviewWorkflowPermissions(permissionsPath, changes)
            let pullRequests = J.Bool(permissions, "can_approve_pull_request_reviews")

            CoordinatorSetup.EventPolicy(repo, path)
            let files = SetupFiles(text, upstream, workflow, current, path)

            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/" + SetupBranchName, missing: true)
            let setup = J.Text(J.Get(reference, "object"), "sha")
            let pulls = GitHub.Api(
                "repos/" + repo + "/pulls?state=open&per_page=1&head=" + Uri.EscapeDataString(
                    repo.Split('/')[0] + ":" + SetupBranchName
                )
            )
            var pull = pulls.ValueKind == JsonValueKind.Array && pulls.GetArrayLength() > 0 ? J.Text(
                pulls[0],
                "html_url"
            ): ""
            let rebuild = files.Count > 0 && !Prepared(repo, setup, head, files)

            if rebuild && text != upstream {
                Change(changes, Policy.FilePath, upstream, text)
            }

            if rebuild && workflow != current {
                Change(changes, path, current, workflow)

                if oldPin != "" {
                    Console.Error.WriteLine(
                        "Compare shared workflows: " + GitHub.WebUrl + "obselate/tokate/compare/" + oldPin + "..." + pin
                    )
                }
            }

            PreviewBranch(changes, rebuild, setup, main, head, files.Count > 0 && pull == "")

            let result = ReportSetup(repo, upstream, policy, existing, changes, manual, files, pull)

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

            ApplyActions(repo, extend, allowlist, patterns, permissionsPath, permissions, pullRequests)

            if rebuild {
                CommitSetup(repo, head, setup, files, owner)
            }

            if files.Count > 0 && pull == "" {
                pull = CreatePull(repo, main)
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

        private func ReadActions(repo string) JsonElement {
            let actions = GitHub.Api("repos/" + repo + "/actions/permissions")

            if !J.Bool(actions, "enabled") {
                throw Exception(
                    "Actions is disabled. Enable Actions in Settings > Actions > General, then run init again"
                )
            }

            return actions
        }

        private func PreviewWorkflowPermissions(permissionsPath string, changes List[Object]) JsonElement {
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

            return permissions
        }

        private func PreviewAllowlist(
            repo string,
            shared string,
            changes List[Object],
            manual List[string],
            allowlist ActionsAllowlist,
            patterns List[string],
            extend bool
        ) {
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
        }

        private func SetupFiles(text string, upstream string, workflow string, current string, path string) List[
            Object
        ] {
            let files = List[Object]()

            if text != upstream {
                files.Add(
                    map[string, Object?]{"path": Policy.FilePath, "mode": "100644", "type": "blob", "content": text}
                )
            }

            if workflow != current {
                files.Add(map[string, Object?]{"path": path, "mode": "100644", "type": "blob", "content": workflow})
            }

            return files
        }

        private func PreviewBranch(
            changes List[Object],
            rebuild bool,
            setup string,
            main string,
            head string,
            createPull bool
        ) {
            if rebuild {
                Change(
                    changes,
                    "Branch " + SetupBranchName,
                    setup,
                    "new commit on " + main + " at " + head + " with the files above"
                )
            }

            if createPull {
                Change(changes, "Setup PR", "", "Set up Tokate, from " + SetupBranchName + " into " + main)
            }
        }

        private func ReportSetup(
            repo string,
            upstream string,
            policy Policy,
            existing Policy?,
            changes List[Object],
            manual List[string],
            files List[Object],
            pull string
        ) Dictionary[string, Object?] {
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
                "Tokate keeps its state in the tokate/access and " +
                    GitHub.ContributionStateRefPrefix +
                    "N branches. Do not delete them or open pull requests from them.",
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

            return result
        }

        private func ApplyActions(
            repo string,
            extend bool,
            allowlist ActionsAllowlist,
            patterns List[string],
            permissionsPath string,
            permissions JsonElement,
            pullRequests bool
        ) {
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
        }

        private func CommitSetup(repo string, head string, setup string, files List[Object], owner Object) {
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
                    map[string, Object?]{"ref": GitHub.HeadsRefPrefix + SetupBranchName, "sha": next}
                )
            } else {
                GitHub.Api(
                    "repos/" + repo + "/git/" + GitHub.HeadsRefPrefix + SetupBranchName,
                    map[string, Object?]{"sha": next, "force": false},
                    "PATCH"
                )
            }
        }

        private func CreatePull(repo string, main string) string -> J.Text(
            GitHub.Api(
                "repos/" + repo + "/pulls",
                map[string, Object?]{
                    "title": "Set up Tokate",
                    "head": repo.Split('/')[0] + ":" + SetupBranchName,
                    "base": main,
                    "body": "Tokate owner setup: policy and coordinator workflow. Merge to finish setup."
                }
            ),
            "html_url"
        )

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
                    "repos/" +
                        repo +
                        "/issues?state=open&labels=tokate%3Aapproved&" +
                        GitHub.PageSizeParameter +
                        "&page=" +
                        page.ToString()
                )
                if issues.ValueKind != JsonValueKind.Array {
                    throw Exception("Cannot list approved issues before policy setup")
                }

                for issue in J.Items(issues) {
                    if J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined || !GitHub.HasLabel(issue) {
                        continue
                    }

                    let number = J.Number(issue, "number")
                    let state = CoordinationState.Load(repo, number, true)
                    let approval = state.Approval
                    if !state.Revoked && approval != nil && approval.PolicyHash != policy.Digest {
                        affected.Add(number)
                    }
                }

                if issues.GetArrayLength() < GitHub.PageSize {
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
