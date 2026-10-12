package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class OwnerApproval {
    shared {
        internal func Approve(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            var number = args.Get("issue") == "" ? 0: args.Number("issue")
            var title = args.Get("title")
            var body = args.Get("body-file") == "" ? args.Get("body"): File.ReadAllText(args.Need("body-file"))
            if number == 0 && title == "" {
                while title == "" {
                    title = WizardScreen.Read("Write an issue", repo, "Title")
                }
                if args.Get("body") == "" && args.Get("body-file") == "" {
                    let lines = List[string]()
                    while true {
                        let line = WizardScreen.Read(
                            "Describe the issue",
                            "Title: " + title + "\n\n" + String.Join("\n", lines),
                            "Description (Enter on an empty line finishes)"
                        )
                        if line == "" {
                            break
                        }
                        lines.Add(line)
                    }
                    body = String.Join("\n", lines)
                }
                if WizardScreen.Choose(
                    "Review issue",
                    repo + "\n\nTitle: " + title + "\n\nDescription:\n" + body,
                    []string{"Create and approve", "Cancel"}
                ) == 2 {
                    return
                }
            }
            WizardScreen.Close()
            let info = RepositoryAccess.RequireOwner(repo)
            var issue = number == 0 ? default(JsonElement): GitHub.Issue(repo, number)
            let authority = J.Text(info, "default_branch")
            let authorityBase = GitHub.Branch(repo, authority)
            let policy = Policy.Load(repo, authorityBase)
            let configuredTarget = J.Text(policy.Value, "target_branch")
            let branch = ApprovalBase.Select(args, configuredTarget == "" ? authority: configuredTarget)
            let revision = branch == authority ? authorityBase: GitHub.Branch(repo, branch)
            AccessState.Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")))
            let firstApproval = !PublicOutput.Enabled && GitHub.Api(
                "repos/" + repo + "/git/matching-refs/heads/tokate/contributions/"
            )
                .GetArrayLength() == 0
            let template = PrBody.Template(repo, authorityBase, policy)
            PrBody.ValidateTemplate(template)
            let commit = GitHub.Api("repos/" + repo + "/git/commits/" + RepositoryIdentity.CommitSha(revision))
            let decree = Decree.CaptureTree(repo, RepositoryIdentity.CommitSha(J.Text(J.Get(commit, "tree"), "sha")))
            if number == 0 {
                issue = GitHub.Api("repos/" + repo + "/issues", map[string, Object?]{"title": title, "body": body})
                args.Values["--issue"] = J.Number(issue, "number").ToString()
                number = args.Number("issue")
                PublicOutput.ResultData = map[string, Object?]{
                    "repo": repo,
                    "issue": number,
                    "issue_url": J.Text(issue, "html_url")
                }
                Terminal.Message(J.Text(issue, "html_url"))
            }
            Terminal.Step(
                "Approving target " + branch + " at " + revision + "; policy/template authority: " + authority
            )
            let label = GitHub.Api("repos/" + repo + "/labels/tokate%3Aapproved", missing: true)
            if label.ValueKind == JsonValueKind.Undefined {
                GitHub.Api(
                    "repos/" + repo + "/labels",
                    map[string, Object?]{
                        "name": "tokate:approved",
                        "color": "0e8a16",
                        "description": "Approved for donated AI usage"
                    }
                )
            }
            CoordinationState.Approve(
                repo,
                number,
                map[string, Object?]{
                    "version": 2,
                    "repo": repo,
                    "repo_id": RepositoryIdentity.PositiveId(J.Get(info, "id")),
                    "issue": number,
                    "approval_scope": "task",
                    "eligibility": policy.Eligibility,
                    "issue_hash": GitHub.Fingerprint(issue),
                    "policy_hash": policy.Digest,
                    "template_hash": Data.Hash(template),
                    "base": revision,
                    "base_branch": branch,
                    "decree": decree,
                    "authority_branch": authority,
                    "nonce": Guid.NewGuid().ToString("N")
                },
                args.Get("yes") == "true"
            )
            GitHub.Api(
                "repos/" + repo + "/issues/" + number.ToString() + "/labels",
                map[string, Object?]{"labels": []string{"tokate:approved"}}
            )
            Terminal.Message("Approval recorded. Request a contribution reservation to begin work.")
            if firstApproval {
                Terminal.Message(
                    "Tokate keeps its state in tokate/ branches; do not open or merge pull requests from them."
                )
            }
        }

        internal func Revoke(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            RepositoryAccess.RequireOwner(repo)
            let state = CoordinationState.Load(repo, args.Number("issue"), true)
            if state.Sha != "" {
                let expected = state.Sha
                state.Fields["revoked"] = true
                state.Write(repo, args.Number("issue"), expected)
            }
            GitHub.Api(
                "repos/" + repo + "/issues/" + args.Number("issue").ToString() + "/labels/tokate%3Aapproved",
                method: "DELETE"
            )
            Terminal.Message(
                "Approval revoked. Active local computation may continue, but Tokate will refuse publication."
            )
        }
    }
}
