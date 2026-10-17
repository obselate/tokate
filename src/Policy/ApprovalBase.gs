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
            let approved = OwnerApproval.Record.Parse(approval)
            let branch = J.Text(GitHub.Api("repos/" + repo), "default_branch")
            let authority = RepositoryIdentity.Branch(approved.AuthorityBranch)

            if branch != authority {
                throw CoordinationState.ApprovalFailure(repo, approved.Issue, "Repository authority branch changed.")
            }

            let current = GitHub.Branch(repo, branch)
            let policy = Policy.Load(repo, current)
            let template = PrBody.Template(repo, current)

            let taskChanged = policy.Digest != approved.PolicyHash
            if taskChanged || J.Hash(template) != approved.TemplateHash {
                var reason = taskChanged ? "Approval no longer matches current task fields.": ""
                if taskChanged {
                    reason += ChangedFields(repo, approved, policy)
                }
                if J.Hash(template) != approved.TemplateHash {
                    reason += (reason == "" ? "": " ") + "PR template changed."
                }
                throw CoordinationState.ApprovalFailure(
                    repo,
                    approved.Issue,
                    "Repository policy or template changed. The owner must approve again. " + reason
                )
            }

            let baseBranch = RepositoryIdentity.Branch(approved.BaseBranch)
            let target = baseBranch == branch ? current: GitHub.Branch(repo, baseBranch)

            Decree.CheckCurrent(repo, target, approval)

            return ValueTuple[Policy, string](policy, template)
        }

        private func ChangedFields(repo string, approved OwnerApproval.Record, current Policy) string {
            try {
                let previous = Policy.Load(repo, approved.Base)
                if previous.Digest == approved.PolicyHash {
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
