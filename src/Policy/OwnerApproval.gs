package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class OwnerApproval {
    shared {
        internal func Approve(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let number = args.Number("issue")
            let info = RepositoryAccess.RequireOwner(repo)
            var issue JsonElement
            try {
                issue = GitHub.Issue(repo, number)
            } catch (error CliFailure) when error.Code == "invalid_state" {
                throw CliFailure("invalid_arguments", error.Message + " Choose an existing open issue reference.")
            }
            let approval = Capture(args, info, issue)
            let firstApproval = !PublicOutput.Enabled && GitHub.Api(
                "repos/" + repo + "/git/matching-refs/heads/tokate/contributions/"
            )
                .GetArrayLength() == 0

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

            approval["issue"] = number
            approval["issue_hash"] = GitHub.Fingerprint(issue)
            CoordinationState.Approve(repo, number, approval)

            GitHub.Api(
                "repos/" + repo + "/issues/" + number.ToString() + "/labels",
                map[string, Object?]{"labels": []string{"tokate:approved"}}
            )

            Terminal.Message(
                "Approved https://github.com/" + repo + "/issues/" + number.ToString() +
                    ". Donors start with: tokate work " +
                    repo +
                    "#" +
                    number.ToString() + " --harness HARNESS --model MODEL --effort EFFORT --time TIME"
            )

            if firstApproval {
                Terminal.Message(
                    "Tokate keeps its state in tokate/ branches; do not open or merge pull requests from them."
                )
            }
        }

        internal func Capture(args Args, info JsonElement, issue JsonElement) Dictionary[string, Object?] {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let authority = J.Text(info, "default_branch")
            let authorityBase = GitHub.Branch(repo, authority)
            let policy = Policy.Load(repo, authorityBase)
            let configuredTarget = J.Text(policy.Value, "target_branch")
            let branch = ApprovalBase.Select(args, configuredTarget == "" ? authority: configuredTarget)
            var revision string
            try {
                revision = branch == authority ? authorityBase: GitHub.Branch(repo, branch)
            } catch (error CliFailure) when error.Code == "invalid_state" && args.Get("base-branch") != "" {
                throw CliFailure("invalid_arguments", error.Message + " Choose an existing --base-branch.")
            }

            AccessState.Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")))

            let template = PrBody.Template(repo, authorityBase)
            PrBody.ValidateTemplate(template)

            let commit = GitHub.Api("repos/" + repo + "/git/commits/" + RepositoryIdentity.CommitSha(revision))
            let decree = Decree.CaptureTree(repo, RepositoryIdentity.CommitSha(J.Text(J.Get(commit, "tree"), "sha")))
            var allowed = []int64{}
            if args.Get("donor") != "" {
                let donor = RepositoryIdentity.Login(args.Get("donor"))
                let user = GitHub.Api("users/" + donor, missing: true)
                if user.ValueKind == JsonValueKind.Undefined {
                    throw CliFailure(
                        "invalid_arguments",
                        "GitHub login " + donor + " does not exist. Choose an existing donor login for tokate approve."
                    )
                }
                allowed = []int64{RepositoryIdentity.PositiveId(J.Get(user, "id"))}
            }

            Terminal.Step(
                "Approving target " + branch + " at " + revision + "; policy/template authority: " + authority
            )

            return map[string, Object?]{
                "version": 2,
                "repo": repo,
                "repo_id": RepositoryIdentity.PositiveId(J.Get(info, "id")),
                "issue": J.Number(issue, "number"),
                "approval_scope": "task",
                "eligibility": policy.Eligibility,
                "allowed_actor_ids": allowed,
                "issue_hash": GitHub.Fingerprint(issue),
                "policy_hash": policy.Digest,
                "template_hash": Data.Hash(template),
                "base": revision,
                "base_branch": branch,
                "decree": decree,
                "authority_branch": authority,
                "nonce": Guid.NewGuid().ToString("N")
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
                method: "DELETE",
                missing: true
            )

            Terminal.Message(
                "Approval revoked. Active local computation may continue, but Tokate will refuse publication."
            )
        }
    }
}
