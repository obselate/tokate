package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class ApprovalBase {
    shared {
        internal func Select(args Args, fallback string) string {
            if args.Get("base-branch") != "" {
                return RepositoryIdentity.Branch(args.Get("base-branch"))
            }

            return RepositoryIdentity.Branch(fallback)
        }

        internal func Check(repo string, approval JsonElement, quiet bool = false) ValueTuple[Policy, string] {
            let branch = J.Text(GitHub.Api("repos/" + repo), "default_branch")
            let authority = RepositoryIdentity.Branch(J.Text(approval, "authority_branch"))

            if branch != authority {
                throw CoordinationState.ApprovalFailure(
                    repo,
                    J.Number(approval, "issue"),
                    "Repository authority branch changed."
                )
            }

            let current = GitHub.Branch(repo, branch)
            let policy = Policy.Load(repo, current)
            let template = PrBody.Template(repo, current)

            let taskChanged = policy.Digest != J.Text(approval, "policy_hash")
            if taskChanged || Data.Hash(template) != J.Text(approval, "template_hash") {
                var reason = taskChanged ? "Approval no longer matches current task fields.": ""
                if taskChanged {
                    reason += ChangedFields(repo, approval, policy)
                }
                if Data.Hash(template) != J.Text(approval, "template_hash") {
                    reason += (reason == "" ? "": " ") + "PR template changed."
                }
                throw CoordinationState.ApprovalFailure(
                    repo,
                    J.Number(approval, "issue"),
                    "Repository policy or template changed. The owner must approve again. " + reason
                )
            }

            let baseBranch = RepositoryIdentity.Branch(J.Text(approval, "base_branch"))
            let target = baseBranch == branch ? current: GitHub.Branch(repo, baseBranch)

            Decree.CheckCurrent(repo, target, approval)

            return ValueTuple[Policy, string](policy, template)
        }

        private func ChangedFields(repo string, approval JsonElement, current Policy) string {
            try {
                let previous = Policy.Load(repo, J.Text(approval, "base"))
                if previous.Digest == J.Text(approval, "policy_hash") {
                    let changed = List[string]()
                    for field in current.TaskFields.EnumerateObject() {
                        if RequestData.Canonical(field.Value) != RequestData.Canonical(
                            J.Get(previous.TaskFields, field.Name)
                        ) {
                            changed.Add(field.Name)
                        }
                    }
                    return " Changed task fields: " + String.Join(", ", changed) + "."
                }
            } catch (error ApiDeadlineException) {
                throw error
            } catch (error Exception) { }

            return " Previous task fields are unavailable or use a legacy approval digest."
        }
    }
}
