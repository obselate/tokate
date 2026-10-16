package Tokate

import System
import System.Collections.Generic
import System.Globalization
import System.Text.Json
import System.Text.RegularExpressions

internal class CoordinationState {
    internal var Sha string = ""
    internal let Fields Dictionary[string, Object?] = Dictionary[string, Object?]()

    internal func Value() JsonElement -> J.Parse(J.Write(Fields))

    internal func ApprovalWarning(repo string) string {
        let value = Value()
        let reservation = J.Get(value, "reservation")
        let contribution = J.Get(value, "contribution")
        let now = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
        let active = reservation.ValueKind == JsonValueKind.Object && J.Text(reservation, "status") != "released" &&
            Unix(reservation, "expires") > now
        var warning = active ? "Re-approval ends the active reservation's authority.": ""

        if contribution.ValueKind == JsonValueKind.Object {
            let pr = repo + "#" + J.Number(J.Get(contribution, "outcome"), "pr").ToString()
            warning += (active ? " ": "") + "Re-approval ends the authority of published PR " + pr + "."
        }

        return warning
    }

    internal func Write(repo string, issue int32, expected string, expires int64 = 0) {
        let tree = GitHub.Api(
            "repos/" + repo + "/git/trees",
            map[string, Object?]{
                "tree": []Object{
                    map[string, Object?]{
                        "path": "state.json",
                        "mode": "100644",
                        "type": "blob",
                        "content": J.Write(Fields)
                    }
                }
            },
            expires: expires
        )

        let commit = GitHub.Api(
            "repos/" + repo + "/git/commits",
            GitHub.AutomationCommit(
                "Tokate coordination #" + issue.ToString(),
                J.Text(tree, "sha"),
                []string{expected},
                GitHub.Bot()
            ),
            expires: expires
        )

        let next = J.Text(commit, "sha")

        if Sha == "" {
            GitHub.Api(
                "repos/" + repo + "/git/refs",
                map[string, Object?]{"ref": "refs/heads/" + Ref(issue), "sha": next},
                expires: expires
            )
        } else {
            for attempt in 0 ... 2 {
                try {
                    GitHub.Api(
                        "repos/" + repo + "/git/refs/heads/" + Ref(issue),
                        map[string, Object?]{"sha": next, "force": false},
                        "PATCH",
                        expires: expires
                    )
                    break
                } catch (error CliFailure) {
                    if attempt > 0 {
                        throw CliFailure(
                            error.Code,
                            error.Message.Replace(
                                "No automatic retry was made.",
                                "One conditional ref retry was made after re-reading current state."
                            ),
                            httpStatus: error.HttpStatus
                        )
                    }

                    if error.HttpStatus < 500 || error.HttpStatus > 599 {
                        throw error
                    }

                    ApiTransport.Settle()
                    let current = Load(repo, issue)

                    if current.Sha == next {
                        break
                    }

                    if current.Sha != expected {
                        throw error
                    }
                }
            }
        }

        Sha = next
    }

    internal func Check(repo string, issue int32, donor string, actor JsonElement) JsonElement {
        let record = CheckApproval(repo, issue)
        let approval = J.Get(record, "approval")

        AccessState.Check(repo, issue, approval, actor, J.Get(record, "policy"))

        return record
    }

    internal func CheckApproval(repo string, issue int32, quiet bool = false) JsonElement {
        let state = Value()
        let approval = J.Get(state, "approval")
        var task JsonElement
        try {
            task = GitHub.Issue(repo, issue)
        } catch (error CliFailure) when error.Code == "invalid_state" {
            throw CliFailure(
                "invalid_state",
                error.Message + " Owner: reopen the issue before continuing this contribution.",
                []string{"gh", "issue", "reopen", issue.ToString(), "--repo", repo}
            )
        }
        if approval.ValueKind == JsonValueKind.Undefined || approval.ValueKind == JsonValueKind.Null {
            throw ApprovalFailure(repo, issue, "Issue is not approved.")
        }
        AccessState.Task(approval)

        if J.Bool(state, "revoked") || !GitHub.HasLabel(task) {
            throw ApprovalFailure(
                repo,
                issue,
                "Approval revoked or task changed. Issue approval is revoked or its approval label is missing."
            )
        }

        if J.Text(approval, "issue_hash") != GitHub.Fingerprint(task) {
            throw ApprovalFailure(repo, issue, "Approval revoked or task changed. Issue text changed since approval.")
        }

        let configuration = ApprovalBase.Check(repo, approval, quiet)
        return J.Parse(
            J.Write(
                map[string, Object?]{
                    "approval": approval,
                    "base": J.Text(J.Get(state, "reservation"), "base"),
                    "policy": configuration.Item1.Value,
                    "template": configuration.Item2,
                    "issue": task
                }
            )
        )
    }

    internal func Reservation(actor JsonElement) {
        LeaseLifecycle.Owner(this, actor, true)
    }

    shared {
        internal func ApprovalFailure(repo string, issue int32, reason string) CliFailure {
            let task = repo + "#" + issue.ToString()
            return CliFailure(
                "stale_approval",
                reason + " The owner must run: tokate approve " + task,
                []string{"tokate", "approve", task}
            )
        }

        internal func Ref(issue int32) string -> "tokate/contributions/" + issue.ToString()

        internal func Unix(value JsonElement, key string) int64 {
            var result int64
            if J.Get(value, key).ValueKind != JsonValueKind.Number || !J.Get(value, key).TryGetInt64(out result) {
                throw CliFailure("invalid_state", "Invalid coordination timestamp")
            }

            return result
        }

        internal func Load(repo string, issue int32, missing bool = false) CoordinationState {
            let result = CoordinationState()
            let reference = GitHub.Api("repos/" + repo + "/git/ref/heads/" + Ref(issue), missing: true)

            if reference.ValueKind == JsonValueKind.Undefined {
                if !missing {
                    throw ApprovalFailure(repo, issue, "Issue is not approved. Approval record is missing.")
                }
                return result
            }

            return At(repo, issue, J.Text(J.Get(reference, "object"), "sha"))
        }

        internal func At(repo string, issue int32, sha string) CoordinationState {
            let result = CoordinationState()
            result.Sha = RepositoryIdentity.CommitSha(sha)

            let value = RequestData.Parse(GitHub.FileAt(repo, "state.json", result.Sha), 1024 * 1024)
            let stateVersion = J.Number(value, "version")
            let stateRepo = J.Text(value, "repo")
            let stateIssue = J.Number(value, "issue")

            if stateVersion != 2 || !RepositoryIdentity.SameRepo(stateRepo, repo) || stateIssue != issue {
                throw CliFailure("invalid_state", "Invalid version-2 coordination state")
            }

            for field in value.EnumerateObject() {
                result.Fields[field.Name] = field.Value.Clone()
            }

            return result
        }

        internal func Approve(repo string, issue int32, approval Object) {
            let state = Load(repo, issue, true)
            let warning = state.ApprovalWarning(repo)
            if warning != "" {
                Terminal.Message(warning, error: true)
            }

            let approved = J.Parse(J.Write(approval))
            let expected = state.Sha == "" ? J.Text(approved, "base"): state.Sha

            state.Fields["version"] = 2
            state.Fields["repo"] = repo
            state.Fields["issue"] = issue
            state.Fields["approval"] = approval
            state.Fields["approval_id"] = J.Hash(RequestData.Canonical(approved))
            state.Fields["revoked"] = false
            state.Fields["identity"] = nil
            state.Fields["publication_revision"] = nil
            state.Fields["reservation"] = nil
            state.Fields["contribution"] = nil
            state.Fields["amendments"] = []Object{}

            if !state.Fields.ContainsKey("outcomes") {
                state.Fields["outcomes"] = []Object{}
            }

            state.Write(repo, issue, expected)
        }

        internal func Current(state JsonElement) JsonElement {
            let amendments = J.Items(J.Get(state, "amendments"))
            return amendments.Count == 0 ? J.Get(state, "contribution"): amendments[amendments.Count - 1]
        }

        internal func Head(state JsonElement) string -> J.Text(J.Get(Current(state), "outcome"), "head")
    }
}
