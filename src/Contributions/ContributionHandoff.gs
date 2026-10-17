package Tokate

import System
import System.Text.Json

internal class ContributionHandoff {
    shared {
        internal func Has(run Data) bool -> J.Get(run.Element(), "handoff").ValueKind != JsonValueKind.Undefined

        internal func StartHead(run Data) string -> Has(run) ? J.Text(
            J.Get(run.Element(), "handoff"),
            "head"
        ): run.Text("base")

        internal func Declaration(value JsonElement) {
            if value.ValueKind == JsonValueKind.Undefined {
                return
            }

            RequestData.Keys(value, "revision,pr,head,fork,donor,actor,id")
            RepositoryIdentity.CommitSha(J.Text(value, "revision"))
            RepositoryIdentity.CommitSha(J.Text(value, "head"))
            RepositoryIdentity.Repo(J.Text(value, "fork"))
            RepositoryIdentity.Login(J.Text(value, "donor"))
            RepositoryIdentity.PositiveId(J.Get(value, "actor"))

            if J.Number(value, "pr") < 1 {
                throw CliFailure("invalid_state", "Handoff needs the prior pull request")
            }

            var id Guid
            if !Guid.TryParseExact(J.Text(value, "id"), "D", out id) || id.ToString("D") != J.Text(value, "id") {
                throw CliFailure("invalid_state", "Handoff needs the prior contribution identity")
            }
        }

        private func Source(state CoordinationState) JsonElement {
            let original = state.Contribution
            let current = state.Current()
            let identity = state.Identity
            let actor = RepositoryIdentity.PositiveId(identity?.ActorValue() ?? default(JsonElement))

            if original == nil || RepositoryIdentity.PositiveId(original.ActorValue()) != actor {
                throw CliFailure("invalid_state", "Handoff requires published progress from the prior donor")
            }

            let source = J.Parse(
                J.Write(
                    map[string, Object?]{
                        "revision": state.Sha,
                        "pr": current?.Outcome.Pr ?? 0,
                        "head": state.Head(),
                        "fork": J.Text(original.Metadata, "fork"),
                        "donor": original.Donor,
                        "actor": actor,
                        "id": identity?.Id ?? ""
                    }
                )
            )

            Declaration(source)

            return source
        }

        internal func Read(state CoordinationState, actor JsonElement, record JsonElement, number int32) JsonElement {
            var prior = state

            if RepositoryIdentity.PositiveId(state.Identity?.ActorValue() ?? default(JsonElement)) == RepositoryIdentity
                .PositiveId(actor) {
                let predecessor = state.Identity?.Predecessor
                prior = CoordinationState.At(state.Repo, state.Issue, predecessor?.Revision ?? "")
            }

            let source = Source(prior)

            if J.Number(source, "pr") != number || RepositoryIdentity.PositiveId(
                J.Get(source, "actor")
            ) == RepositoryIdentity.PositiveId(actor) || prior.ApprovalId != state.ApprovalId {
                throw CliFailure(
                    "invalid_state",
                    "Handoff requires another donor's published contribution under the same approval; use amend --resume for your own work"
                )
            }

            if prior.Sha != state.Sha {
                Authority(state, source)
            }

            let pull = GitHub.Api("repos/" + state.Repo + "/pulls/" + number.ToString())

            if J.Number(pull, "number") != number || J.Bool(pull, "merged") || J.Get(pull, "merged_at")
                .ValueKind == JsonValueKind.String ||
                (J.Text(pull, "state") != "open" && J.Text(pull, "state") != "closed") ||
                !RepositoryIdentity
                .SameRepo(J.Text(J.Get(J.Get(pull, "head"), "repo"), "full_name"), J.Text(source, "fork")) {
                throw CliFailure("invalid_state", "Prior pull request no longer identifies unmerged donor work")
            }

            let repo = state.Repo

            RepositoryAccess.ValidateRepository(
                repo,
                J.Text(source, "fork"),
                J.Get(source, "actor"),
                GitHub.Api("repos/" + J.Text(source, "fork")),
                push: false,
                upstream: GitHub.Api("repos/" + repo)
            )

            GitHubPathEvidence.Check(
                repo,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                OwnerApproval.Record.Parse(J.Get(record, "approval")).Base,
                J.Text(source, "fork"),
                J.Text(source, "head")
            )

            return source
        }

        internal func Authority(state CoordinationState, source JsonElement) {
            if source.ValueKind == JsonValueKind.Undefined {
                return
            }

            Declaration(source)

            let identity = state.Identity
            let predecessor = identity?.Predecessor

            if (predecessor?.Revision ?? "") != J.Text(source, "revision") || (predecessor?.Id ?? "") != J.Text(
                source,
                "id"
            ) ||
                RepositoryIdentity.PositiveId(
                predecessor?.ActorValue() ?? default(JsonElement)
            ) != RepositoryIdentity.PositiveId(J.Get(source, "actor")) || RepositoryIdentity.PositiveId(
                identity?.ActorValue() ?? default(JsonElement)
            ) == RepositoryIdentity
                .PositiveId(J.Get(source, "actor")) {
                throw CliFailure("stale_approval", "Handoff differs from the authoritative donor takeover")
            }

            let repo = state.Repo
            let prior = CoordinationState.At(repo, state.Issue, J.Text(source, "revision"))

            if prior.ApprovalId != state.ApprovalId || !RequestData.Same(Source(prior), source) {
                throw CliFailure("stale_approval", "Handoff source or approval changed")
            }

            GitHubPathEvidence.Ancestor(repo, prior.Sha, repo, state.Sha)
        }

        internal func Candidate(source JsonElement, fork string, head string) {
            if source.ValueKind != JsonValueKind.Undefined {
                Declaration(source)
                GitHubPathEvidence.Ancestor(J.Text(source, "fork"), J.Text(source, "head"), fork, head)
            }
        }

        internal func Supersede(state CoordinationState, request JsonElement) {
            let contribution = state.Contribution
            let source = J.Get(contribution?.Metadata ?? default(JsonElement), "handoff")

            if source.ValueKind == JsonValueKind.Undefined || (contribution?.Request ?? "") != J.Text(request, "uuid") {
                return
            }

            Authority(state, source)

            let number = contribution?.Outcome.Pr ?? 0
            let repo = state.Repo
            let path = "repos/" + repo + "/pulls/" + J.Number(source, "pr").ToString()

            let pull = GitHub.Api(path)

            if number < 1 || number == J.Number(source, "pr") || J.Number(pull, "number") != J.Number(source, "pr") ||
                !RepositoryIdentity
                .SameRepo(J.Text(J.Get(J.Get(pull, "base"), "repo"), "full_name"), repo) {
                throw CliFailure("invalid_state", "Cannot link the superseded contribution")
            }

            let marker = "<!-- tokate-superseded:" + number.ToString() + " -->"
            let body = J.Text(pull, "body")

            if !body.Contains(marker, StringComparison.Ordinal) {
                GitHub.Api(
                    path,
                    map[string, Object?]{
                        "body": body + "\n\n" + marker + "\nSuperseded by #" + number.ToString() +
                            ". The repository owner may close this prior draft after reviewing the successor."
                    },
                    "PATCH"
                )
            }
        }

        internal func Import(checkout string, run Data) {
            let source = J.Get(run.Element(), "handoff")
            if source.ValueKind == JsonValueKind.Undefined {
                return
            }

            let head = Commands.Git(checkout, "rev-parse", "HEAD")

            if head == J.Text(source, "head") {
                return
            }

            if head != run.Text("base") {
                throw CliFailure("invalid_state", "Handoff checkout changed before import; saved work is preserved")
            }

            Commands.Git(
                checkout,
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                "--",
                "https://github.com/" + J.Text(source, "fork") + ".git",
                J.Text(source, "head")
            )

            Commands.Git(checkout, "merge", "--quiet", "--ff-only", "--no-edit", J.Text(source, "head"))
        }
    }
}
