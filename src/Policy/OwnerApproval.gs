package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class OwnerApproval {
    internal class Record {
        internal var Version int64
        internal var Repo string
        internal var RepoId int64
        internal var Issue int32
        internal var ApprovalScope string
        internal var Eligibility string
        internal var AllowedActorIds List[int64]
        internal var IssueHash string
        internal var PolicyHash string
        internal var TemplateHash string
        internal var Base string
        internal var BaseBranch string
        internal var AuthorityBranch string
        internal var Nonce string
        internal var Decree JsonElement
        internal var Donor JsonElement
        private var Source JsonElement

        shared {
            private const FormatName string = "Approval record"

            internal func Parse(value JsonElement) Record {
                let version = JsonFields.Int64(value, FormatName, "version")
                let repo = JsonFields.String(value, FormatName, "repo")
                let repoId = JsonFields.Int64(value, FormatName, "repo_id")
                let issue = JsonFields.Int32(value, FormatName, "issue")
                let approvalScope = JsonFields.String(value, FormatName, "approval_scope")
                let eligibility = JsonFields.String(value, FormatName, "eligibility")
                let issueHash = JsonFields.String(value, FormatName, "issue_hash")
                let policyHash = JsonFields.String(value, FormatName, "policy_hash")
                let templateHash = JsonFields.String(value, FormatName, "template_hash")
                let base = JsonFields.String(value, FormatName, "base")
                let baseBranch = JsonFields.String(value, FormatName, "base_branch")
                let authorityBranch = JsonFields.String(value, FormatName, "authority_branch")
                let nonce = JsonFields.String(value, FormatName, "nonce")

                let allowed = List[int64]()
                var actors JsonElement
                if value.TryGetProperty("allowed_actor_ids", out actors) {
                    for actor in JsonFields.Array(value, FormatName, "allowed_actor_ids").EnumerateArray() {
                        var id int64
                        if actor.ValueKind != JsonValueKind.Number || !actor.TryGetInt64(out id) {
                            throw CliFailure(
                                "invalid_state",
                                FormatName + ": field \"allowed_actor_ids\" must contain int64 values"
                            )
                        }
                        allowed.Add(id)
                    }
                }

                var decree = JsonElement{}
                var donor = JsonElement{}
                value.TryGetProperty("decree", out decree)
                value.TryGetProperty("donor", out donor)

                return Record{
                    Version: version,
                    Repo: repo,
                    RepoId: repoId,
                    Issue: issue,
                    ApprovalScope: approvalScope,
                    Eligibility: eligibility,
                    AllowedActorIds: allowed,
                    IssueHash: issueHash,
                    PolicyHash: policyHash,
                    TemplateHash: templateHash,
                    Base: base,
                    BaseBranch: baseBranch,
                    AuthorityBranch: authorityBranch,
                    Nonce: nonce,
                    Decree: decree,
                    Donor: donor,
                    Source: value
                }
            }
        }

        internal func Write(writer Utf8JsonWriter) {
            if Source.ValueKind != JsonValueKind.Undefined {
                Source.WriteTo(writer)
                return
            }

            writer.WriteStartObject()
            writer.WriteNumber("version", Version)
            writer.WriteString("repo", Repo)
            writer.WriteNumber("repo_id", RepoId)
            writer.WriteNumber("issue", Issue)
            writer.WriteString("approval_scope", ApprovalScope)
            writer.WriteString("eligibility", Eligibility)
            writer.WriteStartArray("allowed_actor_ids")
            for actor in AllowedActorIds {
                writer.WriteNumberValue(actor)
            }
            writer.WriteEndArray()
            writer.WriteString("issue_hash", IssueHash)
            writer.WriteString("policy_hash", PolicyHash)
            writer.WriteString("template_hash", TemplateHash)
            writer.WriteString("base", Base)
            writer.WriteString("base_branch", BaseBranch)
            if Decree.ValueKind != JsonValueKind.Undefined {
                writer.WritePropertyName("decree")
                Decree.WriteTo(writer)
            }
            writer.WriteString("authority_branch", AuthorityBranch)
            writer.WriteString("nonce", Nonce)
            writer.WriteEndObject()
        }

        internal func Value() JsonElement {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)

            Write(writer)
            writer.Flush()

            return J.Parse(Encoding.UTF8.GetString(bytes.ToArray()))
        }
    }

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
            let firstApproval = !Output.Sink.Enabled && GitHub.Api(
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

            approval.Issue = number
            approval.IssueHash = GitHub.Fingerprint(issue)
            CoordinationState.Approve(repo, number, approval)

            GitHub.Api(
                "repos/" + repo + "/issues/" + number.ToString() + "/labels",
                map[string, Object?]{"labels": []string{"tokate:approved"}}
            )

            Output.Sink.Message(
                "Approved https://github.com/" + repo + "/issues/" + number.ToString() +
                    ". Donors start with: tokate work " +
                    repo +
                    "#" +
                    number.ToString() + " --harness HARNESS --model MODEL --effort EFFORT --time TIME"
            )

            if firstApproval {
                Output.Sink.Message(
                    "Tokate keeps its state in tokate/ branches; do not open or merge pull requests from them."
                )
            }
        }

        internal func Capture(args Args, info JsonElement, issue JsonElement) Record {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let authority = J.Text(info, "default_branch")
            let authorityBase = GitHub.Branch(repo, authority)
            let policy = Policy.Load(repo, authorityBase)
            let configuredTarget = policy.TargetBranch
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
            let allowed = List[int64]()
            if args.Get("donor") != "" {
                let donor = RepositoryIdentity.Login(args.Get("donor"))
                let user = GitHub.Api("users/" + donor, missing: true)
                if user.ValueKind == JsonValueKind.Undefined {
                    throw CliFailure(
                        "invalid_arguments",
                        "GitHub login " + donor + " does not exist. Choose an existing donor login for tokate approve."
                    )
                }
                allowed.Add(RepositoryIdentity.PositiveId(J.Get(user, "id")))
            }

            Output.Sink.Step(
                "Approving target " + branch + " at " + revision + "; policy/template authority: " + authority
            )

            return Record{
                Version: 2,
                Repo: repo,
                RepoId: RepositoryIdentity.PositiveId(J.Get(info, "id")),
                Issue: J.Number(issue, "number"),
                ApprovalScope: "task",
                Eligibility: policy.Eligibility,
                AllowedActorIds: allowed,
                IssueHash: GitHub.Fingerprint(issue),
                PolicyHash: policy.Digest,
                TemplateHash: J.Hash(template),
                Base: revision,
                BaseBranch: branch,
                Decree: decree,
                AuthorityBranch: authority,
                Nonce: Guid.NewGuid().ToString("N")
            }
        }

        internal func Revoke(args Args) {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))

            RepositoryAccess.RequireOwner(repo)

            let state = CoordinationState.Load(repo, args.Number("issue"), true)

            if state.Sha != "" {
                let expected = state.Sha
                state.Revoked = true
                state.Include("revoked")

                state.Write(repo, args.Number("issue"), expected)
            }

            GitHub.Api(
                "repos/" + repo + "/issues/" + args.Number("issue").ToString() + "/labels/tokate%3Aapproved",
                method: "DELETE",
                missing: true
            )

            Output.Sink.Message(
                "Approval revoked. Active local computation may continue, but Tokate will refuse publication."
            )
        }
    }
}
