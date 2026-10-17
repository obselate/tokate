package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class AttemptContinuation {
    shared {
        private const RetryBudgetMultiplier int32 = 2

        private const VerificationReserveDivisor int32 = 3

        internal func Has(run Data) bool -> run.ContinuationSource != ""

        internal func Stopped(run Data) bool -> Harness.Resumes(run.Harness, run.Provider) &&
            run.Source == "tokate" &&
            run.State == "failed" &&
            run.PreparationVersion == 1 &&
            run.FailureStage == "inference" &&
            !run.TurnCompleted &&
            run.Commit == "" &&
            run.Pr == 0 &&
            (
            run.FailureReason == "inference_interrupted" ||
                !run.Unlimited &&
                (
                run.Error.StartsWith("Runtime limit reached", StringComparison.Ordinal) ||
                    run.Error == "Runtime allowance exhausted"
            )
        )

        internal func Next(directory string, run Data) Dictionary[string, Object?] {
            let target = run.Repo + "#" + run.Issue.ToString()
            let next = map[string, Object?]{
                "role": "donor",
                "action": "Read current authority before continuing the stopped run with a new time budget.",
                "command": []string{"tokate", "status", target, "--json"}
            }

            try {
                let state = CoordinationState.Load(run.Repo, run.Issue)
                let viewer = GitHub.Api("user")
                let record = state.CheckApproval(run.Repo, run.Issue, quiet: true)
                LeaseLifecycle.Owner(state, J.Get(viewer, "id"))

                if !RepositoryIdentity.SameDonor(viewer, run) ||
                    state.ApprovalId != run.Approval ||
                    (state.Identity?.Id ?? "") != run.Id {
                    return next
                }

                let seconds = Math.Min(
                    run.Seconds * RetryBudgetMultiplier,
                    Policy.Parse(J.Get(record, "policy")).MaxSeconds
                )
                let reserve = run.VerificationReserve > 0 ? run.VerificationReserve:
                Math.Max(1, seconds / VerificationReserveDivisor)
                let command = List[string]{
                    "tokate",
                    "work",
                    target,
                    "--continue-from",
                    directory,
                    "--time",
                    seconds.ToString() + "s",
                    "--verify-time",
                    reserve.ToString() + "s",
                    "--fork",
                    run.HeadRepo
                }

                for (option, value) in[]ValueTuple[string, string]{
                    ValueTuple[string, string]("harness", run.Harness),
                    ValueTuple[string, string]("provider", run.Provider),
                    ValueTuple[string, string]("model", run.Model),
                    ValueTuple[string, string]("effort", run.Effort),
                    ValueTuple[string, string]("harness-path", run.HarnessPath),
                    ValueTuple[string, string]("endpoint", run.PiEndpoint),
                    ValueTuple[string, string]("pi-root", run.PiRoot),
                    ValueTuple[string, string]("node", run.PiNode),
                } {
                    if value != "" {
                        command.AddRange([]string{"--" + option, value})
                    }
                }

                command.AddRange([]string{"--yes", "--json"})
                next["command"] = command.ToArray()
                next[
                    "action"
                ] = "Review the new time budget, then work on a fresh attempt with the stopped run's partial changes."
                let reservation = state.Lease
                if (reservation?.Attempt ?? "") == run.Attempt || (reservation?.Status ?? "") == "paused" {
                    next["action"] = "First " +
                        (
                        (reservation?.Status ?? "") == "paused" ? "":
                        Output.Sink.Command([]string{"tokate", "pause", "--run", directory}) + ", then "
                    ) +
                        Output
                        .Sink
                        .Command([]string{"tokate", "resume", "--run", directory}) +
                        ". Wait for each coordinator acceptance, then read status again. Review the new time budget before work."
                }
            } catch (error Exception) when error is CliFailure ||
                error is JsonException ||
                error is ApiDeadlineException ||
                error.GetType() == typeof(Exception) { }

            return next
        }

        private func Id(value string) {
            var id Guid
            if !Guid.TryParseExact(value, "D", out id) || id.ToString("D") != value {
                throw CliFailure("invalid_state", "Continuation requires canonical contribution and attempt identities")
            }
        }

        internal func Store(args Args) string {
            let source = LocalPaths.DirectoryPath(args.Need("continue-from"))
            let root = Path.GetDirectoryName(source) ??
                throw CliFailure("invalid_state", "Unsupported source run store")

            if args.Get("runs") != "" && LocalPaths.DirectoryPath(args.Need("runs")) != root {
                throw CliFailure(
                    "invalid_state",
                    "Continuation must use the source run store so each destination fence has one saved run"
                )
            }

            return root
        }

        internal func Location(directory string, run Data) {
            if AttemptContinuation.Has(run) && Path.GetFullPath(directory) != Path.Combine(
                Path.GetDirectoryName(run.ContinuationSource) ?? "",
                run.Name == "" ? run.Attempt: run.Name
            ) {
                throw CliFailure(
                    "invalid_state",
                    "Continuation destination moved or shares an ambiguous execution fence; use its original saved run"
                )
            }
        }

        internal func Provenance(source Data) JsonElement {
            let prior = J.Select(
                source.Element(),
                "id,attempt,state_sha,approval,base,state,failure_reason,harness,provider,model,effort"
            )
            prior["version"] = 2
            prior["repo_id"] = source.PreparationRepoId
            prior["donor_id"] = source.DonorId

            return J.Parse(J.Write(prior))
        }

        private func Predecessor(prior JsonElement, attempt string, tools JsonElement) {
            let parsed = ContinuationPredecessor.Parse(prior)

            Id(parsed.Id)
            Id(parsed.Attempt)
            Id(attempt)
            RepositoryIdentity.CommitSha(parsed.StateSha)
            RepositoryIdentity.CommitSha(parsed.Base)
            RepositoryIdentity.PositiveId(parsed.Donor)
            RepositoryIdentity.PositiveId(parsed.Repository)

            RequestMetadata.Tools(tools)

            let declared = J.Items(tools)

            if parsed.Attempt == attempt || !Regex.IsMatch(parsed.Approval, "^[0-9a-f]{64}$") ||
                (parsed.State != "failed" && parsed.State != "running") ||
                declared.Count != 1 ||
                !Harness.Resumes(parsed.Harness, parsed.Provider) || Array.IndexOf(
                []string{"inference_failed", "inference_interrupted", "incomplete_turn"},
                parsed.FailureReason
            ) < 0 {
                throw CliFailure("invalid_state", "Invalid stopped managed v2 predecessor or destination attempt")
            }

            let tool = ToolDeclaration.Parse(declared[0])
            if parsed.Harness != tool.Harness ||
                parsed.Provider != tool.Provider ||
                parsed.Model != tool.Model ||
                parsed.Effort != tool.Effort {
                throw CliFailure("invalid_state", "Continuation cannot change its predecessor tool selection")
            }

            if parsed.Version != 2 {
                throw CliFailure("invalid_state", "Invalid stopped managed v2 predecessor or destination attempt")
            }
        }

        internal func Declaration(metadata JsonElement) PublicationRequestMetadata? {
            if J.Get(metadata, "predecessor").ValueKind == JsonValueKind.Undefined && J.Get(
                metadata,
                "import_manifest_sha256"
            )
                .ValueKind == JsonValueKind.Undefined {
                return nil
            }

            return Declaration(PublicationRequestMetadata.Parse(metadata))
        }

        internal func Declaration(declaration PublicationRequestMetadata) PublicationRequestMetadata? {
            if declaration.Predecessor.ValueKind == JsonValueKind.Undefined && !declaration.HasImportManifest {
                return nil
            }

            if declaration.Predecessor.ValueKind != JsonValueKind.Object {
                throw CliFailure(
                    "invalid_state",
                    "Continuation request metadata: field \"predecessor\" is missing or not an object"
                )
            }

            let manifest = declaration.ImportManifestValue
            if declaration.SourceKind != "tokate" || manifest.ValueKind != JsonValueKind.String || !Regex.IsMatch(
                manifest.GetString() ?? "",
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Continuation requires managed source and bound import evidence")
            }

            Predecessor(declaration.Predecessor, declaration.Attempt, declaration.Tools)

            return declaration
        }

        internal func Authority(state CoordinationState, prior JsonElement) {
            let parsed = ContinuationPredecessor.Parse(prior)
            let reservation = state.Lease
            let identity = state.Identity
            let actor = RepositoryIdentity.PositiveId(parsed.Donor)
            let repoId = RepositoryIdentity.PositiveId(parsed.Repository)
            let approvedRepo = state.Approval?.RepoId ?? 0

            if RepositoryIdentity.PositiveId(J.Get(GitHub.Api("repos/" + state.Repo), "id")) != repoId ||
                (approvedRepo != 0 && approvedRepo != repoId) {
                throw CliFailure("stale_approval", "Continuation repository numeric identity changed")
            }

            if !LeaseLifecycle.Supported(state) ||
                (reservation?.Status ?? "") != "active" ||
                (reservation?.Attempt ?? "") == parsed.Attempt ||
                (reservation?.Reservation ?? "") != parsed.Id ||
                (identity?.Id ?? "") != parsed.Id ||
                RepositoryIdentity.PositiveId(identity?.ActorJson ?? default(JsonElement)) != actor ||
                RepositoryIdentity.PositiveId(reservation?.ActorJson ?? default(JsonElement)) != actor ||
                state.ApprovalId != parsed.Approval ||
                (reservation?.Base ?? "") != parsed.Base {
                throw CliFailure(
                    "stale_approval",
                    "Continuation needs unchanged authority and a fresh same-donor attempt"
                )
            }

            let original = CoordinationState.At(state.Repo, state.Issue, parsed.StateSha)

            GitHubPathEvidence.Ancestor(state.Repo, original.Sha, state.Repo, state.Sha)

            let old = original.Lease
            let oldIdentity = original.Identity

            if !LeaseLifecycle.Supported(original) ||
                original.Revoked ||
                original.ApprovalId != parsed.Approval ||
                !RequestData.Same(
                original.Approval?.Value() ?? default(JsonElement),
                state.Approval?.Value() ?? default(JsonElement)
            ) ||
                (old?.Status ?? "") != "active" ||
                (old?.Attempt ?? "") != parsed.Attempt ||
                (old?.Reservation ?? "") != parsed.Id ||
                (oldIdentity?.Id ?? "") != parsed.Id ||
                RepositoryIdentity.PositiveId(old?.ActorJson ?? default(JsonElement)) != actor ||
                RepositoryIdentity.PositiveId(oldIdentity?.ActorJson ?? default(JsonElement)) != actor ||
                original.Contribution != nil ||
                original
                .Amendments
                .Count != 0 {
                throw CliFailure(
                    "stale_approval",
                    "Ambiguous predecessor lineage or changed approval and contribution evidence"
                )
            }
        }

        internal func Recheck(run Data, state CoordinationState) {
            let prior = run.Continuation

            if !AttemptContinuation.Has(run) &&
                prior.ValueKind == JsonValueKind.Undefined &&
                !run.HasContinuationManifestSha256 {
                return
            }

            if !AttemptContinuation.Has(run) || run.Source != "tokate" || !Regex.IsMatch(
                run.ContinuationSourceMetadataSha256,
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Saved continuation lost its explicit import identity")
            }

            RuntimeBudget.Validate(run)
            Predecessor(prior, run.Attempt, run.Tools)
            Authority(state, prior)

            if run.State != "preparing" || run.ContinuationPhase != "" {
                Declaration(Metadata(run))
            }
        }

        internal func Metadata(run Data) JsonElement -> J.Parse(
            J.Write(
                map[string, Object?]{
                    "source": run.Source,
                    "tools": run.Tools,
                    "attempt": run.Attempt,
                    "predecessor": run.Continuation,
                    "import_manifest_sha256": run.ContinuationManifestSha256
                }
            )
        )

        internal func Keep(fields Dictionary[string, Object?], metadata PublicationRequestMetadata) {
            if let declaration = Declaration(metadata) {
                fields["predecessor"] = declaration.Predecessor
                fields["import_manifest_sha256"] = declaration.ImportManifestValue
                fields["attempt"] = declaration.Attempt
            }
        }

        internal func Source(directory string, run Data, record JsonElement) Data {
            let source = Data.Parse(J.Parse(ContinuationImport.Metadata(directory)))
            let state = source.State

            if source.Version != 2 ||
                source.PreparationVersion != 1 ||
                source.Source != "tokate" ||
                source.TurnCompleted ||
                (state != "failed" && state != "running") ||
                source.FailureStage != "inference" ||
                Harness.Find(source.Harness) == nil || source.HarnessVersion(source.Harness) == "" ||
                source.Commit != "" ||
                source.Pr != 0 ||
                source.PrUrl != "" ||
                source.PublicationUuid != "" ||
                source.PublicationExpected != "" {
                throw CliFailure(
                    "invalid_state",
                    "Source must be stopped, unpublished managed v2 work with incomplete coding"
                )
            }

            for name in[]string{"publication.json", "request.json", "request.json.posting.json", "amendments"} {
                let path = Path.Combine(directory, name)
                if File.Exists(path) || Directory.Exists(path) || FileInfo(path).LinkTarget != nil {
                    throw CliFailure(
                        "invalid_state",
                        "Publication-pending or corrected source work cannot be continued"
                    )
                }
            }

            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, source) || !RepositoryIdentity.SameDonor(viewer, run) ||
                !RepositoryIdentity.SameRepo(source.Repo, run.Repo) || source.Issue != run.Issue {
                throw CliFailure(
                    "invalid_state",
                    "Continuation source has a different numeric donor, repository or issue"
                )
            }

            for (key, previous, current) in[]ValueTuple[string, string, string]{
                ValueTuple[string, string, string]("approval", source.Approval, run.Approval),
                ValueTuple[string, string, string]("base", source.Base, run.Base),
                ValueTuple[string, string, string]("base_branch", source.BaseBranch, run.BaseBranch),
                ValueTuple[string, string, string]("policy_hash", source.PolicyHash, run.PolicyHash),
                ValueTuple[string, string, string]("id", source.Id, run.Id),
                ValueTuple[string, string, string]("branch", source.Branch, run.Branch),
                ValueTuple[string, string, string]("harness", source.Harness, run.Harness),
                ValueTuple[string, string, string]("harness_path", source.HarnessPath, run.HarnessPath),
                ValueTuple[string, string, string]("provider", source.Provider, run.Provider),
                ValueTuple[string, string, string]("model", source.Model, run.Model),
                ValueTuple[string, string, string]("effort", source.Effort, run.Effort),
                ValueTuple[string, string, string]("pi_endpoint", source.PiEndpoint, run.PiEndpoint),
                ValueTuple[string, string, string]("pi_root", source.PiRoot, run.PiRoot),
                ValueTuple[string, string, string]("pi_node", source.PiNode, run.PiNode),
                ValueTuple[string, string, string]("claude_profile", source.ClaudeProfile, run.ClaudeProfile),
            } {
                if previous != current {
                    throw CliFailure("invalid_state", "Continuation changed predecessor binding or selection: " + key)
                }
            }

            let live = CoordinationState.Load(run.Repo, run.Issue)

            live.Reservation(J.Get(viewer, "id"))
            LeaseLifecycle.Fence(live, run.Attempt)

            let checked = live.Check(run.Repo, run.Issue, run.Donor, J.Get(viewer, "id"))

            if !RequestData.Same(J.Get(checked, "approval"), J.Get(record, "approval")) || live.Contribution != nil {
                throw CliFailure("stale_approval", "Published or changed authority cannot be continued")
            }

            Predecessor(Provenance(source), run.Attempt, run.Tools)
            Authority(live, Provenance(source))

            WorkspacePreparation.Source(Path.Combine(directory, "checkout"), source)

            CheckRepositories(source, run, viewer)

            return source
        }

        private func CheckRepositories(source Data, run Data, viewer JsonElement) {
            let upstream = GitHub.Api("repos/" + run.Repo)
            let head = GitHub.Api("repos/" + RepositoryIdentity.Repo(source.HeadRepo))
            let repoId = RepositoryIdentity.PositiveId(J.Get(upstream, "id"))

            if repoId != RepositoryIdentity.PositiveId(source.PreparationRepoId) ||
                repoId != RepositoryIdentity.PositiveId(run.PreparationRepoId) || RepositoryIdentity.PositiveId(
                J.Get(head, "id")
            ) != RepositoryIdentity.PositiveId(source.PreparationHeadId) || !RepositoryIdentity.SameRepo(
                source.HeadRepo,
                run.HeadRepo
            ) {
                throw CliFailure("stale_approval", "Continuation repository or fork identity changed")
            }

            RepositoryAccess.ValidateRepository(
                source.Repo,
                source.HeadRepo,
                RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                head,
                upstream: upstream
            )

            if Publication.Pulls(source).Count != 0 {
                throw CliFailure("invalid_state", "Published contributions cannot be imported")
            }

            let reference = GitHub.Api(
                "repos/" + source.HeadRepo + "/git/ref/heads/" + Uri.EscapeDataString(source.Branch)
            )

            if J.Text(J.Get(reference, "object"), "sha") != source.Base {
                throw CliFailure(
                    "invalid_state",
                    "Source branch changed or publication is pending; source is preserved"
                )
            }
        }
    }
}

internal class ContinuationPredecessor(value JsonElement) {
    internal let Version int32 = J.Number(value, "version")
    internal let Id string = J.Text(value, "id")
    internal let Attempt string = J.Text(value, "attempt")
    internal let StateSha string = J.Text(value, "state_sha")
    internal let Approval string = J.Text(value, "approval")
    internal let Base string = J.Text(value, "base")
    internal let Repository JsonElement = J.Get(value, "repo_id")
    internal let Donor JsonElement = J.Get(value, "donor_id")
    internal let State string = J.Text(value, "state")
    internal let FailureReason string = J.Text(value, "failure_reason")
    internal let Harness string = J.Text(value, "harness")
    internal let Provider string = J.Text(value, "provider")
    internal let Model string = J.Text(value, "model")
    internal let Effort string = J.Text(value, "effort")

    shared {
        internal func Parse(value JsonElement) ContinuationPredecessor {
            RequestData.Keys(
                value,
                "version,id,attempt,state_sha,approval,base,repo_id,donor_id,state,failure_reason,harness,provider,model,effort"
            )

            return ContinuationPredecessor(value)
        }
    }
}
