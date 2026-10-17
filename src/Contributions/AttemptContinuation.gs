package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class AttemptContinuation {
    shared {
        internal func Has(run Data) bool -> run.Text("continuation_source") != ""

        internal func Stopped(run Data) bool -> Harness.Resumes(run.Text("harness"), run.Text("provider")) && run.Text(
            "source"
        ) == "tokate" &&
            run.Text("state") == "failed" && run.Number("preparation_version") == 1 && run.Text(
            "failure_stage"
        ) == "inference" &&
            !run.Flag("turn_completed") && run.Text("commit") == "" && run.Number("pr") == 0 &&
            (
            run.Text("failure_reason") == "inference_interrupted" || !run.Flag("unlimited") &&
                (
                run.Text("error").StartsWith("Runtime limit reached", StringComparison.Ordinal) || run.Text(
                    "error"
                ) == "Runtime allowance exhausted"
            )
        )

        internal func Next(directory string, run Data) Dictionary[string, Object?] {
            let target = run.Text("repo") + "#" + run.Number("issue").ToString()
            let next = map[string, Object?]{
                "role": "donor",
                "action": "Read current authority before continuing the stopped run with a new time budget.",
                "command": []string{"tokate", "status", target, "--json"}
            }

            try {
                let state = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
                let viewer = GitHub.Api("user")
                let record = state.CheckApproval(run.Text("repo"), run.Number("issue"), quiet: true)
                LeaseLifecycle.Owner(state, J.Get(viewer, "id"))

                if !RepositoryIdentity.SameDonor(viewer, run) || J.Text(state.Value(), "approval_id") != run.Text(
                    "approval"
                ) ||
                    J.Text(J.Get(state.Value(), "identity"), "id") != run.Text("id") {
                    return next
                }

                let seconds = Math.Min(run.Number("seconds") * 2, J.Number(J.Get(record, "policy"), "max_seconds"))
                let reserve = run.Number("verification_reserve") > 0 ? run.Number("verification_reserve"): Math.Max(
                    1,
                    seconds / 3
                )
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
                    run.Text("head_repo")
                }

                for key in[]string{
                    "harness",
                    "provider",
                    "model",
                    "effort",
                    "harness_path",
                    "pi_endpoint",
                    "pi_root",
                    "pi_node"
                } {
                    if run.Text(key) != "" {
                        let option = key == "pi_endpoint" ? "endpoint": key == "pi_node" ? "node": key.Replace('_', '-')
                        command.AddRange([]string{"--" + option, run.Text(key)})
                    }
                }

                command.AddRange([]string{"--yes", "--json"})
                next["command"] = command.ToArray()
                next[
                    "action"
                ] = "Review the new time budget, then work on a fresh attempt with the stopped run's partial changes."
                let reservation = J.Get(state.Value(), "reservation")
                if J.Text(reservation, "attempt") == run.Text("attempt") || J.Text(reservation, "status") == "paused" {
                    next["action"] = "First " +
                        (
                        J.Text(reservation, "status") == "paused" ? "":
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
                Path.GetDirectoryName(run.Text("continuation_source")) ?? "",
                run.Text("name") == "" ? run.Text("attempt"): run.Text("name")
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
            prior["repo_id"] = J.Get(source.Element(), "preparation_repo_id")
            prior["donor_id"] = J.Get(source.Element(), "donor_id")

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

            if parsed.Version != 2 || parsed.Attempt == attempt || !Regex.IsMatch(parsed.Approval, "^[0-9a-f]{64}$") ||
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
        }

        internal func Declaration(metadata JsonElement) ContinuationRequestMetadata? {
            let parsed = ContinuationRequestMetadata.Parse(metadata)
            guard let declaration = parsed else {
                return nil
            }

            if declaration.SourceKind != "tokate" || !Regex.IsMatch(
                declaration.ImportManifestSha256,
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Continuation requires managed source and bound import evidence")
            }

            Predecessor(declaration.Predecessor, declaration.Attempt, declaration.Tools)

            return declaration
        }

        internal func Authority(state CoordinationState, prior JsonElement) {
            let parsed = ContinuationPredecessor.Parse(prior)
            let value = state.Value()
            let approval = J.Get(value, "approval")
            let reservation = J.Get(value, "reservation")
            let identity = J.Get(value, "identity")
            let actor = RepositoryIdentity.PositiveId(parsed.Donor)
            let repoId = RepositoryIdentity.PositiveId(parsed.Repository)

            if RepositoryIdentity.PositiveId(J.Get(GitHub.Api("repos/" + J.Text(value, "repo")), "id")) != repoId ||
                (
                J.Get(approval, "repo_id").ValueKind != JsonValueKind.Undefined && RepositoryIdentity.PositiveId(
                    J.Get(approval, "repo_id")
                ) != repoId
            ) {
                throw CliFailure("stale_approval", "Continuation repository numeric identity changed")
            }

            if !LeaseLifecycle.Supported(value) || J.Text(reservation, "status") != "active" || J.Text(
                reservation,
                "attempt"
            ) == parsed.Attempt ||
                J.Text(reservation, "reservation") != parsed.Id || J.Text(identity, "id") != parsed.Id ||
                RepositoryIdentity.PositiveId(J.Get(identity, "actor")) != actor || RepositoryIdentity.PositiveId(
                J.Get(reservation, "actor")
            ) != actor ||
                J.Text(value, "approval_id") != parsed.Approval || J.Text(reservation, "base") != parsed.Base {
                throw CliFailure(
                    "stale_approval",
                    "Continuation needs unchanged authority and a fresh same-donor attempt"
                )
            }

            let original = CoordinationState.At(J.Text(value, "repo"), J.Number(value, "issue"), parsed.StateSha)
            let evidence = original.Value()

            GitHubPathEvidence.Ancestor(J.Text(value, "repo"), original.Sha, J.Text(value, "repo"), state.Sha)

            let old = J.Get(evidence, "reservation")
            let oldIdentity = J.Get(evidence, "identity")

            if !LeaseLifecycle.Supported(evidence) || J.Bool(evidence, "revoked") || J.Text(
                evidence,
                "approval_id"
            ) != parsed.Approval ||
                !RequestData.Same(J.Get(evidence, "approval"), approval) || J.Text(old, "status") != "active" || J.Text(
                old,
                "attempt"
            ) != parsed.Attempt ||
                J.Text(old, "reservation") != parsed.Id || J.Text(oldIdentity, "id") != parsed.Id ||
                RepositoryIdentity.PositiveId(J.Get(old, "actor")) != actor || RepositoryIdentity.PositiveId(
                J.Get(oldIdentity, "actor")
            ) != actor ||
                J
                .Get(evidence, "contribution").ValueKind == JsonValueKind.Object || J.Items(
                J.Get(evidence, "amendments")
            )
                .Count != 0 {
                throw CliFailure(
                    "stale_approval",
                    "Ambiguous predecessor lineage or changed approval and contribution evidence"
                )
            }
        }

        internal func Recheck(run Data, state CoordinationState) {
            let prior = J.Get(run.Element(), "continuation")

            if !AttemptContinuation.Has(run) && prior.ValueKind == JsonValueKind.Undefined && !run.Fields.ContainsKey(
                "continuation_manifest_sha256"
            ) {
                return
            }

            if !AttemptContinuation.Has(run) || run.Text("source") != "tokate" || !Regex.IsMatch(
                run.Text("continuation_source_metadata_sha256"),
                "^[0-9a-f]{64}$"
            ) {
                throw CliFailure("invalid_state", "Saved continuation lost its explicit import identity")
            }

            RuntimeBudget.Validate(run)
            Predecessor(prior, run.Text("attempt"), J.Get(run.Element(), "tools"))
            Authority(state, prior)

            if run.Text("state") != "preparing" || run.Text("continuation_phase") != "" {
                Declaration(Metadata(run))
            }
        }

        internal func Metadata(run Data) JsonElement -> J.Parse(
            J.Write(
                map[string, Object?]{
                    "source": run.Text("source"),
                    "tools": J.Get(run.Element(), "tools"),
                    "attempt": run.Text("attempt"),
                    "predecessor": J.Get(run.Element(), "continuation"),
                    "import_manifest_sha256": run.Text("continuation_manifest_sha256")
                }
            )
        )

        internal func Keep(fields Dictionary[string, Object?], metadata JsonElement) {
            if let declaration = Declaration(metadata) {
                fields["predecessor"] = declaration.Predecessor
                fields["import_manifest_sha256"] = declaration.ImportManifestSha256
                fields["attempt"] = declaration.Attempt
            }
        }

        internal func Source(directory string, run Data, record JsonElement) Data {
            let source = Data.From(J.Parse(ContinuationImport.Metadata(directory)))
            let state = source.Text("state")

            if source.Number("version") != 2 || source.Number("preparation_version") != 1 || source.Text(
                "source"
            ) != "tokate" ||
                source.Flag("turn_completed") || (state != "failed" && state != "running") || source.Text(
                "failure_stage"
            ) != "inference" ||
                Harness.Find(source.Text("harness")) == nil || source.Text(source.Text("harness") + "_version") == "" ||
                source.Text("commit") != "" || source.Number("pr") != 0 || source.Text("pr_url") != "" || source.Text(
                "publication_uuid"
            ) != "" ||
                source.Text("publication_expected") != "" {
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
                !RepositoryIdentity.SameRepo(source.Text("repo"), run.Text("repo")) || source.Number("issue") != run
                .Number("issue") {
                throw CliFailure(
                    "invalid_state",
                    "Continuation source has a different numeric donor, repository or issue"
                )
            }

            for key in[]string{
                "approval",
                "base",
                "base_branch",
                "policy_hash",
                "id",
                "branch",
                "harness",
                "harness_path",
                "provider",
                "model",
                "effort",
                "pi_endpoint",
                "pi_root",
                "pi_node",
                "claude_profile",
            } {
                if source.Text(key) != run.Text(key) {
                    throw CliFailure("invalid_state", "Continuation changed predecessor binding or selection: " + key)
                }
            }

            let live = CoordinationState.Load(run.Text("repo"), run.Number("issue"))

            live.Reservation(J.Get(viewer, "id"))
            LeaseLifecycle.Fence(live, run.Text("attempt"))

            let checked = live.Check(run.Text("repo"), run.Number("issue"), run.Text("donor"), J.Get(viewer, "id"))

            if !RequestData.Same(J.Get(checked, "approval"), J.Get(record, "approval")) || J.Get(
                live.Value(),
                "contribution"
            )
                .ValueKind == JsonValueKind.Object {
                throw CliFailure("stale_approval", "Published or changed authority cannot be continued")
            }

            Predecessor(Provenance(source), run.Text("attempt"), J.Get(run.Element(), "tools"))
            Authority(live, Provenance(source))

            WorkspacePreparation.Source(Path.Combine(directory, "checkout"), source)

            CheckRepositories(source, run, viewer)

            return source
        }

        private func CheckRepositories(source Data, run Data, viewer JsonElement) {
            let upstream = GitHub.Api("repos/" + run.Text("repo"))
            let head = GitHub.Api("repos/" + RepositoryIdentity.Repo(source.Text("head_repo")))
            let repoId = RepositoryIdentity.PositiveId(J.Get(upstream, "id"))

            if repoId != RepositoryIdentity.PositiveId(J.Get(source.Element(), "preparation_repo_id")) ||
                repoId != RepositoryIdentity.PositiveId(J.Get(run.Element(), "preparation_repo_id")) ||
                RepositoryIdentity.PositiveId(J.Get(head, "id")) != RepositoryIdentity.PositiveId(
                J.Get(source.Element(), "preparation_head_id")
            ) ||
                !RepositoryIdentity
                .SameRepo(source.Text("head_repo"), run.Text("head_repo")) {
                throw CliFailure("stale_approval", "Continuation repository or fork identity changed")
            }

            RepositoryAccess.ValidateRepository(
                source.Text("repo"),
                source.Text("head_repo"),
                J.Get(viewer, "id"),
                head,
                upstream: upstream
            )

            if Publication.Pulls(source).Count != 0 {
                throw CliFailure("invalid_state", "Published contributions cannot be imported")
            }

            let reference = GitHub.Api(
                "repos/" + source.Text("head_repo") + "/git/ref/heads/" + Uri.EscapeDataString(source.Text("branch"))
            )

            if J.Text(J.Get(reference, "object"), "sha") != source.Text("base") {
                throw CliFailure(
                    "invalid_state",
                    "Source branch changed or publication is pending; source is preserved"
                )
            }
        }
    }
}

internal class ContinuationPredecessor(value JsonElement) {
    private let Source JsonElement = value
    internal let Version int32 = JsonFields.Int32(value, "Continuation predecessor", "version")
    internal let Id string = JsonFields.String(value, "Continuation predecessor", "id")
    internal let Attempt string = JsonFields.String(value, "Continuation predecessor", "attempt")
    internal let StateSha string = JsonFields.String(value, "Continuation predecessor", "state_sha")
    internal let Approval string = JsonFields.String(value, "Continuation predecessor", "approval")
    internal let Base string = JsonFields.String(value, "Continuation predecessor", "base")
    internal let RepoId int64 = JsonFields.Int64(value, "Continuation predecessor", "repo_id")
    internal let DonorId int64 = JsonFields.Int64(value, "Continuation predecessor", "donor_id")
    internal let Repository JsonElement = J.Get(value, "repo_id")
    internal let Donor JsonElement = J.Get(value, "donor_id")
    internal let State string = JsonFields.String(value, "Continuation predecessor", "state")
    internal let FailureReason string = JsonFields.String(value, "Continuation predecessor", "failure_reason")
    internal let Harness string = JsonFields.String(value, "Continuation predecessor", "harness")
    internal let Provider string = JsonFields.String(value, "Continuation predecessor", "provider")
    internal let Model string = JsonFields.String(value, "Continuation predecessor", "model")
    internal let Effort string = JsonFields.String(value, "Continuation predecessor", "effort")

    internal func Write(writer Utf8JsonWriter) -> Source.WriteTo(writer)

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

internal class ContinuationRequestMetadata(value JsonElement) {
    internal let SourceKind string = JsonFields.String(value, "Continuation request metadata", "source")
    internal let Attempt string = JsonFields.String(value, "Continuation request metadata", "attempt")
    internal let Tools JsonElement = JsonFields.Array(value, "Continuation request metadata", "tools")
    internal let ImportManifestSha256 string = JsonFields.String(
        value,
        "Continuation request metadata",
        "import_manifest_sha256"
    )
    internal let Predecessor JsonElement = J.Get(value, "predecessor")

    shared {
        internal func Parse(value JsonElement) ContinuationRequestMetadata? {
            let predecessor = J.Get(value, "predecessor")

            if predecessor.ValueKind == JsonValueKind.Undefined && J.Get(value, "import_manifest_sha256")
                .ValueKind == JsonValueKind.Undefined {
                return nil
            }

            if predecessor.ValueKind != JsonValueKind.Object {
                throw CliFailure(
                    "invalid_state",
                    "Continuation request metadata: field \"predecessor\" is missing or not an object"
                )
            }

            return ContinuationRequestMetadata(value)
        }
    }
}
