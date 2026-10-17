package Tokate

import System
import System.Text.Json

internal class ContributionHandoff {
    shared {
        internal func Has(run Data) bool -> J.Get(run.Element(), "handoff").ValueKind != JsonValueKind.Undefined

        internal func StartHead(run Data) string -> Has(run) ? HandoffRequestMetadata.Parse(
            J.Get(run.Element(), "handoff")
        )
            .Head: run.Text("base")

        internal func Declaration(value JsonElement) {
            if value.ValueKind == JsonValueKind.Undefined {
                return
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
        }

        private func Source(state CoordinationState) JsonElement {
            let value = state.Value()
            let original = J.Get(value, "contribution")
            let current = CoordinationState.Current(value)
            let identity = J.Get(value, "identity")
            let actor = RepositoryIdentity.PositiveId(J.Get(identity, "actor"))

            if original.ValueKind != JsonValueKind.Object || RepositoryIdentity.PositiveId(
                J.Get(original, "actor")
            ) != actor {
                throw CliFailure("invalid_state", "Handoff requires published progress from the prior donor")
            }

            let publication = PublicationRequestMetadata.Parse(J.Get(original, "metadata"))
            let source = J.Parse(
                J.Write(
                    map[string, Object?]{
                        "revision": state.Sha,
                        "pr": J.Number(J.Get(current, "outcome"), "pr"),
                        "head": CoordinationState.Head(value),
                        "fork": publication.Fork,
                        "donor": J.Text(original, "donor"),
                        "actor": actor,
                        "id": J.Text(identity, "id")
                    }
                )
            )

            Declaration(source)

            return source
        }

        internal func Read(state CoordinationState, actor JsonElement, record JsonElement, number int32) JsonElement {
            let value = state.Value()
            var prior = state

            if RepositoryIdentity.PositiveId(J.Get(J.Get(value, "identity"), "actor")) == RepositoryIdentity.PositiveId(
                actor
            ) {
                let predecessor = J.Get(J.Get(value, "identity"), "predecessor")
                prior = CoordinationState.At(
                    J.Text(value, "repo"),
                    J.Number(value, "issue"),
                    J.Text(predecessor, "revision")
                )
            }

            let source = Source(prior)
            let parsed = HandoffRequestMetadata.Parse(source)

            if parsed.Pr != number || RepositoryIdentity.PositiveId(parsed.Actor) == RepositoryIdentity.PositiveId(
                actor
            ) ||
                J.Text(prior.Value(), "approval_id") != J.Text(value, "approval_id") {
                throw CliFailure(
                    "invalid_state",
                    "Handoff requires another donor's published contribution under the same approval; use amend --resume for your own work"
                )
            }

            if prior.Sha != state.Sha {
                Authority(state, source)
            }

            let pull = GitHub.Api("repos/" + J.Text(value, "repo") + "/pulls/" + number.ToString())

            if J.Number(pull, "number") != number || J.Bool(pull, "merged") || J.Get(pull, "merged_at")
                .ValueKind == JsonValueKind.String ||
                (J.Text(pull, "state") != "open" && J.Text(pull, "state") != "closed") ||
                !RepositoryIdentity
                .SameRepo(J.Text(J.Get(J.Get(pull, "head"), "repo"), "full_name"), parsed.Fork) {
                throw CliFailure("invalid_state", "Prior pull request no longer identifies unmerged donor work")
            }

            let repo = J.Text(value, "repo")

            RepositoryAccess.ValidateRepository(
                repo,
                parsed.Fork,
                parsed.Actor,
                GitHub.Api("repos/" + parsed.Fork),
                push: false,
                upstream: GitHub.Api("repos/" + repo)
            )

            GitHubPathEvidence.Check(
                repo,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                J.Text(J.Get(record, "approval"), "base"),
                parsed.Fork,
                parsed.Head
            )

            return source
        }

        internal func Authority(state CoordinationState, source JsonElement) {
            if source.ValueKind == JsonValueKind.Undefined {
                return
            }

            Declaration(source)
            let parsed = HandoffRequestMetadata.Parse(source)

            let value = state.Value()
            let identity = J.Get(value, "identity")
            let predecessor = J.Get(identity, "predecessor")

            if J.Text(predecessor, "revision") != parsed.Revision || J.Text(predecessor, "id") != parsed.Id ||
                RepositoryIdentity.PositiveId(J.Get(predecessor, "actor")) != RepositoryIdentity.PositiveId(
                parsed.Actor
            ) ||
                RepositoryIdentity.PositiveId(J.Get(identity, "actor")) == RepositoryIdentity.PositiveId(parsed.Actor) {
                throw CliFailure("stale_approval", "Handoff differs from the authoritative donor takeover")
            }

            let repo = J.Text(value, "repo")
            let prior = CoordinationState.At(repo, J.Number(value, "issue"), parsed.Revision)

            if J.Text(prior.Value(), "approval_id") != J.Text(value, "approval_id") || !RequestData.Same(
                Source(prior),
                source
            ) {
                throw CliFailure("stale_approval", "Handoff source or approval changed")
            }

            GitHubPathEvidence.Ancestor(repo, prior.Sha, repo, state.Sha)
        }

        internal func Candidate(source JsonElement, fork string, head string) {
            if source.ValueKind != JsonValueKind.Undefined {
                Declaration(source)
                let parsed = HandoffRequestMetadata.Parse(source)
                GitHubPathEvidence.Ancestor(parsed.Fork, parsed.Head, fork, head)
            }
        }

        internal func Supersede(state CoordinationState, request JsonElement) {
            let contribution = J.Get(state.Value(), "contribution")
            let metadata = J.Get(contribution, "metadata")
            let source = metadata.ValueKind == JsonValueKind.Object ?
            PublicationRequestMetadata.Parse(metadata).Handoff: JsonElement{}

            if source.ValueKind == JsonValueKind.Undefined || J.Text(contribution, "request") != CoordinatorRequest
                .Parse(request).Uuid {
                return
            }

            Authority(state, source)
            let parsed = HandoffRequestMetadata.Parse(source)

            let number = J.Number(J.Get(contribution, "outcome"), "pr")
            let repo = J.Text(state.Value(), "repo")
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
            let source = J.Get(run.Element(), "handoff")
            if source.ValueKind == JsonValueKind.Undefined {
                return
            }

            let parsed = HandoffRequestMetadata.Parse(source)
            let head = Commands.Git(checkout, "rev-parse", "HEAD")

            if head == parsed.Head {
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
                "https://github.com/" + parsed.Fork + ".git",
                parsed.Head
            )

            Commands.Git(checkout, "merge", "--quiet", "--ff-only", "--no-edit", parsed.Head)
        }
    }
}

internal class HandoffRequestMetadata(value JsonElement) {
    private let Source JsonElement = value
    internal let Revision string = JsonFields.String(value, "Handoff request metadata", "revision")
    internal let Pr int32 = JsonFields.Int32(value, "Handoff request metadata", "pr")
    internal let Head string = JsonFields.String(value, "Handoff request metadata", "head")
    internal let Fork string = JsonFields.String(value, "Handoff request metadata", "fork")
    internal let Donor string = JsonFields.String(value, "Handoff request metadata", "donor")
    internal let ActorId int64 = JsonFields.Int64(value, "Handoff request metadata", "actor")
    internal let Actor JsonElement = J.Get(value, "actor")
    internal let Id string = JsonFields.String(value, "Handoff request metadata", "id")

    internal func Write(writer Utf8JsonWriter) -> Source.WriteTo(writer)

    shared {
        internal func Parse(value JsonElement) HandoffRequestMetadata {
            RequestData.Keys(value, "revision,pr,head,fork,donor,actor,id")

            return HandoffRequestMetadata(value)
        }
    }
}
