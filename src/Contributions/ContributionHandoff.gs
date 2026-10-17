package Tokate

import System
import System.Text.Json

internal class ContributionHandoff {
    shared {
        internal func Has(run Data) bool -> run.Handoff.ValueKind != JsonValueKind.Undefined

        internal func StartHead(run Data) string -> Has(run) ? HandoffRequestMetadata.Parse(run.Handoff).Head: run.Base

        internal func Declaration(value JsonElement) HandoffRequestMetadata? {
            if value.ValueKind == JsonValueKind.Undefined {
                return nil
            }

            let parsed = HandoffRequestMetadata.Parse(value)
            RepositoryIdentity.CommitSha(parsed.Revision)
            RepositoryIdentity.CommitSha(parsed.Head)
            RepositoryIdentity.Repo(parsed.Fork)
            RepositoryIdentity.Login(parsed.Donor)
            RepositoryIdentity.PositiveId(parsed.Actor)

            if parsed.Pr < 1 {
                throw CliFailure("invalid_state", "Handoff needs the prior pull request")
            }

            var id Guid
            if !Guid.TryParseExact(parsed.Id, "D", out id) || id.ToString("D") != parsed.Id {
                throw CliFailure("invalid_state", "Handoff needs the prior contribution identity")
            }

            return parsed
        }

        private func Source(state CoordinationState) JsonElement {
            let original = state.Contribution
            let current = state.Current()
            let identity = state.Identity
            let actor = RepositoryIdentity.PositiveId(identity?.ActorJson ?? default(JsonElement))

            if original == nil || RepositoryIdentity.PositiveId(original.ActorJson) != actor {
                throw CliFailure("invalid_state", "Handoff requires published progress from the prior donor")
            }

            let publication = PublicationRequestMetadata.Parse(original.Metadata)
            let source = J.Parse(
                J.Write(
                    map[string, Object?]{
                        "revision": state.Sha,
                        "pr": current?.Outcome.Pr ?? 0,
                        "head": state.Head(),
                        "fork": publication.Fork,
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

            if RepositoryIdentity.PositiveId(state.Identity?.ActorJson ?? default(JsonElement)) == RepositoryIdentity
                .PositiveId(actor) {
                let predecessor = state.Identity?.Predecessor
                prior = CoordinationState.At(state.Repo, state.Issue, predecessor?.Revision ?? "")
            }

            let source = Source(prior)
            let parsed = HandoffRequestMetadata.Parse(source)

            if parsed.Pr != number || RepositoryIdentity.PositiveId(parsed.Actor) == RepositoryIdentity.PositiveId(
                actor
            ) ||
                prior.ApprovalId != state
                .ApprovalId {
                throw CliFailure(
                    "invalid_state",
                    "Handoff requires another donor's published contribution under the same approval; use amend --resume for your own work"
                )
            }

            if prior.Sha != state.Sha {
                Authority(state, parsed)
            }

            let pull = GitHub.Api("repos/" + state.Repo + "/pulls/" + number.ToString())

            if J.Number(pull, "number") != number || J.Bool(pull, "merged") || J.Get(pull, "merged_at")
                .ValueKind == JsonValueKind.String ||
                (J.Text(pull, "state") != "open" && J.Text(pull, "state") != "closed") ||
                !RepositoryIdentity
                .SameRepo(J.Text(J.Get(J.Get(pull, "head"), "repo"), "full_name"), parsed.Fork) {
                throw CliFailure("invalid_state", "Prior pull request no longer identifies unmerged donor work")
            }

            let repo = state.Repo

            RepositoryAccess.ValidateRepository(
                repo,
                parsed.Fork,
                RepositoryIdentity.PositiveId(parsed.Actor),
                GitHub.Api("repos/" + parsed.Fork),
                push: false,
                upstream: GitHub.Api("repos/" + repo)
            )

            GitHubPathEvidence.Check(
                repo,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                OwnerApproval.Record.Parse(J.Get(record, "approval")).Base,
                parsed.Fork,
                parsed.Head
            )

            return source
        }

        internal func Authority(state CoordinationState, source HandoffRequestMetadata?) {
            if source == nil {
                return
            }

            let identity = state.Identity
            let predecessor = identity?.Predecessor

            if (predecessor?.Revision ?? "") != source.Revision ||
                (predecessor?.Id ?? "") != source.Id ||
                RepositoryIdentity.PositiveId(
                predecessor?.ActorJson ?? default(JsonElement)
            ) != RepositoryIdentity.PositiveId(source.Actor) || RepositoryIdentity.PositiveId(
                identity?.ActorJson ?? default(JsonElement)
            ) == RepositoryIdentity
                .PositiveId(source.Actor) {
                throw CliFailure("stale_approval", "Handoff differs from the authoritative donor takeover")
            }

            let repo = state.Repo
            let prior = CoordinationState.At(repo, state.Issue, source.Revision)

            if prior.ApprovalId != state.ApprovalId || !RequestData.Same(Source(prior), source.Value) {
                throw CliFailure("stale_approval", "Handoff source or approval changed")
            }

            GitHubPathEvidence.Ancestor(repo, prior.Sha, repo, state.Sha)
        }

        internal func Candidate(source HandoffRequestMetadata?, fork string, head string) {
            if source != nil {
                GitHubPathEvidence.Ancestor(source.Fork, source.Head, fork, head)
            }
        }

        internal func Supersede(state CoordinationState, request JsonElement) {
            let contribution = state.Contribution
            let metadata = contribution?.Metadata ?? default(JsonElement)
            let source = metadata.ValueKind == JsonValueKind.Object ? PublicationRequestMetadata.Parse(metadata)
                .Handoff: JsonElement{}

            if source.ValueKind == JsonValueKind.Undefined || (contribution?.Request ?? "") != CoordinatorRequest.Parse(
                request
            )
                .Uuid {
                return
            }

            guard let parsed = Declaration(source) else {
                return
            }
            Authority(state, parsed)

            let number = contribution?.Outcome.Pr ?? 0
            let repo = state.Repo
            let path = "repos/" + repo + "/pulls/" + parsed.Pr.ToString()

            let pull = GitHub.Api(path)

            if number < 1 || number == parsed.Pr || J.Number(pull, "number") != parsed.Pr ||
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
            let source = run.Handoff
            if source.ValueKind == JsonValueKind.Undefined {
                return
            }

            let parsed = HandoffRequestMetadata.Parse(source)
            let head = Commands.Git(checkout, "rev-parse", "HEAD")

            if head == parsed.Head {
                return
            }

            if head != run.Base {
                throw CliFailure("invalid_state", "Handoff checkout changed before import; saved work is preserved")
            }

            Commands.Git(
                checkout,
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                "--",
                "https://github.com/" + parsed.Fork + ".git",
                parsed.Head
            )

            Commands.Git(checkout, "merge", "--quiet", "--ff-only", "--no-edit", parsed.Head)
        }
    }
}

internal class HandoffRequestMetadata(value JsonElement) {
    internal let Revision string = JsonFields.String(value, "Handoff request metadata", "revision")
    internal let Pr int32 = JsonFields.Int32(value, "Handoff request metadata", "pr")
    internal let Head string = JsonFields.String(value, "Handoff request metadata", "head")
    internal let Fork string = JsonFields.String(value, "Handoff request metadata", "fork")
    internal let Donor string = JsonFields.String(value, "Handoff request metadata", "donor")
    internal let Actor JsonElement = J.Get(value, "actor")
    internal let Id string = JsonFields.String(value, "Handoff request metadata", "id")
    internal let Value JsonElement = value

    shared {
        internal func Parse(value JsonElement) HandoffRequestMetadata {
            RequestData.Keys(value, "revision,pr,head,fork,donor,actor,id")

            return HandoffRequestMetadata(value)
        }
    }
}
