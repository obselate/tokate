package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class ContributionPreparation {
    shared {
        internal const GratisBranchPrefix string = "tokate/gratis-"

        private func Prepare(
            args Args,
            repo string,
            issue int32,
            viewer JsonElement,
            state CoordinationState,
            record JsonElement
        ) string {
            state.Reservation(J.Get(viewer, "id"))
            Overlaps.RequireDependencies(repo, issue)

            let run = Plan(args, repo, issue, viewer, state, record, args.Get("source", "tokate"))
            Bind(run, state)

            let directory = Allocate(
                args.Get("continue-from") != "" ? AttemptContinuation.Store(args): RunStorage.Store(args),
                run,
                run.Attempt
            )

            WorkspacePreparation.Select(run, args.Get("fork"))

            if args.Get("continue-from") != "" {
                if run.Source != "tokate" || run.Attempt == "" {
                    throw CliFailure("invalid_state", "Continuation requires a managed v2 fresh active attempt")
                }

                let sourceDirectory = LocalPaths.DirectoryPath(args.Need("continue-from"))
                using let sourceLease = ContinuationImport.SourceLease(sourceDirectory)
                let source = AttemptContinuation.Source(sourceDirectory, run, record)
                run.ContinuationSource = sourceDirectory
                run.Continuation = AttemptContinuation.Provenance(source)
                run.ContinuationSourceMetadataSha256 = J.Hash(ContinuationImport.Metadata(sourceDirectory))
            }

            if run.Source == "tokate" {
                Output.Sink.ConfirmSelection(args, run.Selection, run)
            }

            Create(directory)
            using let lease = RunStorage.Lease(directory)

            WorkspacePreparation.Initialize(directory, run, args.Get("fork"))

            return Complete(directory, run)
        }

        private func Complete(directory string, run Data) string {
            if run.Source == "tokate" {
                Output.Sink.Step(RuntimeBudget.Description(run))
            }

            Output.Sink.Step("Preparing contribution. Run: " + directory)
            WorkspacePreparation.Complete(directory, run)
            Output.Sink.Message("Prepared contribution. Run: " + directory)

            return directory
        }

        private func Plan(
            args Args,
            repo string,
            issue int32,
            viewer JsonElement,
            state CoordinationState?,
            record JsonElement,
            source string
        ) Data {
            let donor = RepositoryIdentity.Login(J.Text(viewer, "login"))
            let policy = Policy(J.Write(J.Get(record, "policy")))

            var tools = args.Get("tools") == "" ? JsonElement{}: RequestData.FileData(
                args.Need("tools"),
                RequestData.RequestByteLimit
            )
            var selection = JsonElement{}

            if tools.ValueKind != JsonValueKind.Undefined {
                RequestMetadata.Tools(tools)
                policy.ValidateTools(tools, source)
            }

            let approval = J.Get(record, "approval")
            let approved = OwnerApproval.Record.Parse(approval)

            if source == "tokate" {
                if tools.ValueKind != JsonValueKind.Undefined {
                    let declared = J.Items(tools)[0]

                    for key in[]string{"harness", "provider", "model", "effort"} {
                        if args.Get(key) != "" && args.Get(key) != J.Text(declared, key) {
                            throw CliFailure(
                                "invalid_state",
                                "Explicit selection conflicts with declared tool; no model substitution is allowed"
                            )
                        }

                        args.Values["--" + key] = J.Text(declared, key)
                    }
                }

                policy.Digest = approved.PolicyHash
                selection = SelectionPolicy.Resolve(args, policy)

                if tools.ValueKind == JsonValueKind.Undefined {
                    tools = J.Parse(J.Write([]Object{J.Select(selection, "harness,provider,model,effort")}))
                }
            }

            if state != nil && state.Contribution != nil && args.Get("from-pr") == "" {
                throw CliFailure(
                    "invalid_state",
                    "Published work is preserved; saved-checkout continuation remains unsupported until #14"
                )
            }

            let run = Data{
                Version: 2,
                Repo: repo,
                Issue: issue,
                Donor: donor,
                DonorId: RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                HeadRepo: RepositoryIdentity.Repo(args.Get("fork", donor + "/" + repo.Split('/')[1])),
                Approval: state?.ApprovalId ?? "",
                Base: approved.Base,
                BaseBranch: approved.BaseBranch,
                PolicyHash: approved.PolicyHash,
                Source: source,
                Tools: tools
            }

            if args.Get("from-pr") != "" {
                run.Handoff = ContributionHandoff.Read(
                    state ?? throw CliFailure("invalid_state", "Gratis work cannot adopt a contribution"),
                    J.Get(viewer, "id"),
                    record,
                    args.Number("from-pr")
                )
            }

            PlanBudget(args, run, policy)

            if source == "tokate" {
                let declared = J.Items(tools)[0]
                run.Model = J.Text(declared, "model")
                run.RequestedModel = J.Text(declared, "model")
                run.ReportedModel = nil
                run.Effort = J.Text(declared, "effort")
                run.Harness = J.Text(selection, "harness")
                run.Provider = J.Text(selection, "provider")
                run.Selection = selection

                if args.Get("harness-path") != "" {
                    run.HarnessPath = LocalPaths.RuntimePath(args.Need("harness-path"))
                }

                if Harness.Owns(J.Text(selection, "harness"), "claude-profile") {
                    run.ClaudeProfile = args.Need("claude-profile")
                }

                if Harness.Owns(J.Text(selection, "harness"), "endpoint") {
                    run.PiEndpoint = PiBoundary.Endpoint(args.Need("endpoint"))
                    run.PiRoot = args.Need("pi-root")
                    run.PiNode = args.Need("node")
                }
            }

            RuntimeBudget.Validate(run)

            return run
        }

        private func PlanBudget(args Args, run Data, policy Policy) {
            if args.Get("unlimited") != "true" {
                args.Need("seconds")
            }

            run.Seconds = RuntimeBudget.ReadSeconds(args)

            if args.Get("unlimited") == "true" {
                run.Unlimited = true
            }

            if args.Get("verification-reserve") != "" {
                run.VerificationReserve = RuntimeBudget.Reserve(args, run.Seconds)
            }

            policy.ValidateBudget(run.Seconds, run.Unlimited)
        }

        private func Allocate(store string, run Data, id string) string {
            let directory = RunStorage.Allocate(store, run.Repo, run.Issue, id, AttemptContinuation.Stopped)
            Output.Sink.RunDirectory = directory
            run.Name = Path.GetFileName(directory)
            return directory
        }

        private func Create(directory string) -> Directory.CreateDirectory(
            directory,
            UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
        )

        private func Bind(run Data, state CoordinationState) {
            let reservation = state.Lease
            run.Base = RepositoryIdentity.CommitSha(reservation?.Base ?? "")
            run.Id = reservation?.Reservation ?? ""
            run.StateSha = state.Sha
            run.Attempt = reservation?.Attempt ?? ""
            run.Branch = GitHub.ContributionBranchPrefix + run.Id
        }

        internal func Acquire(args Args, gratis JsonElement = default(JsonElement)) string {
            if gratis.ValueKind != JsonValueKind.Undefined {
                let viewer = GitHub.Api("user")
                let repo = args.Need("repo")
                let issue = J.Number(J.Get(gratis, "issue"), "number")
                let run = Plan(args, repo, issue, viewer, nil, gratis, "tokate")
                run.Gratis = true
                let context = map[string, Object?]{}

                for field in gratis.EnumerateObject() {
                    if field.Name != "pulls" {
                        context[field.Name] = field.Value
                    }
                }

                run.GratisContext = J.Parse(J.Write(context))
                run.PolicyHash = Policy(J.Write(J.Get(gratis, "policy"))).Digest
                let id = Guid.NewGuid().ToString("N")
                run.Id = id
                run.Attempt = id
                run.Branch = GratisBranchPrefix + id
                let directory = Allocate(RunStorage.Store(args), run, id)
                WorkspacePreparation.Select(run, args.Get("fork"))
                Create(directory)
                using let lease = RunStorage.Lease(directory)
                WorkspacePreparation.Initialize(directory, run, args.Get("fork"))
                WorkspacePreparation.Complete(directory, run)
                File.WriteAllText(Path.Combine(directory, "open-prs.json"), J.Write(J.Get(gratis, "pulls")))
                return directory
            }
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let info = GitHub.Api("repos/" + repo)
            let branch = J.Text(info, "default_branch")
            let revision = GitHub.Branch(repo, branch)
            let policy = Policy.Load(repo, revision)

            let issue = args.Number("issue")
            let viewer = GitHub.Api("user")
            let donor = RepositoryIdentity.Login(J.Text(viewer, "login"))
            let state = CoordinationState.Load(repo, issue)
            let record = state.Check(repo, issue, donor, J.Get(viewer, "id"))

            let reservation = state.Lease

            if reservation != nil &&
                reservation.Status != "released" &&
                reservation.Expires > DateTimeOffset
                .UtcNow
                .ToUnixTimeSeconds() {
                if !Output.Sink.Donating && RepositoryIdentity.PositiveId(reservation.ActorJson)
                == RepositoryIdentity.PositiveId(J.Get(viewer, "id")) && state.Contribution == nil {
                    return Prepare(args, repo, issue, viewer, state, record)
                }

                throw CliFailure("invalid_state", "An unexpired reservation already owns this contribution")
            }

            if args.Get("continue-from") != "" {
                throw CliFailure(
                    "invalid_state",
                    "Continuation requires your active fresh attempt; pause and resume the stopped run first. No claim was posted"
                )
            }

            if reservation != nil && !LeaseLifecycle.Supported(state) {
                throw CliFailure("stale_approval", "Legacy lease reacquisition requires fresh owner approval")
            }

            Overlaps.RequireDependencies(repo, issue)

            let run = Plan(args, repo, issue, viewer, state, record, args.Get("source", "tokate"))

            run.Transition("claim_pending")

            if run.Source != "external" {
                Output.Sink.ConfirmSelection(args, run.Selection, run)
            }

            let pendingRequest = CoordinatorRequest(
                Guid.NewGuid().ToString("D"),
                state.Sha,
                run.Approval,
                "claim",
                J.Parse("{}")
            )
            let request = J.Parse(pendingRequest.ToJson())

            let declaration = RequestMetadata.Request(request)

            run.ClaimRequest = request
            run.RequestedFork = args.Get("fork")

            let directory = Allocate(RunStorage.Store(args), run, declaration.Uuid)
            Create(directory)
            using let lease = RunStorage.Lease(directory)

            WorkspacePreparation.Pending(directory, run)

            return Pending(directory, run, args)
        }

        internal func Resume(directory string, args Args) string {
            Output.Sink.RunDirectory = directory
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)

            if args.Command == "work" && run.PreparationComplete {
                return directory
            }

            if run.Source == "tokate" {
                Output.Sink.ConfirmSelection(args, run.Selection, run)
            }

            return run.State == "claim_pending" ? Pending(directory, run, args): Complete(directory, run)
        }

        private func CheckPending(run Data, viewer JsonElement, state CoordinationState) {
            let request = run.ClaimRequest
            let declaration = RequestMetadata.Request(request)

            if run.Version != 2 ||
                run.State != "claim_pending" ||
                (run.Source != "tokate" && run.Source != "external") ||
                declaration.Action != "claim" ||
                !RepositoryIdentity.SameDonor(viewer, run) ||
                run.HasId ||
                run.HasAttempt ||
                run.HasPreparationIdentity {
                throw CliFailure("invalid_state", "Invalid saved pending claim; no authority was acquired")
            }

            if declaration.Approval != run.Approval || state.ApprovalId != run.Approval {
                throw CliFailure("stale_approval", "Pending claim approval changed; original work is preserved")
            }

            let record = state.Check(run.Repo, run.Issue, run.Donor, J.Get(viewer, "id"))
            let approval = OwnerApproval.Record.Parse(J.Get(record, "approval"))

            if run.Base != approval.Base ||
                run.BaseBranch != approval.BaseBranch ||
                run.PolicyHash != approval.PolicyHash {
                throw CliFailure("stale_approval", "Pending claim differs from current owner approval")
            }

            let policy = Policy(J.Write(J.Get(record, "policy")))
            policy.Digest = run.PolicyHash

            let tools = run.Tools

            RequestMetadata.Tools(tools)
            policy.ValidateTools(tools, run.Source)

            if run.Source == "tokate" &&
                (
                run.Selection.ValueKind != JsonValueKind.Object || run.Harness != J.Text(
                    J.Items(tools)[0],
                    "harness"
                ) ||
                    run.Provider != J.Text(J.Items(tools)[0], "provider") || run.Model != J.Text(
                    J.Items(tools)[0],
                    "model"
                ) ||
                    run.Effort != J.Text(J.Items(tools)[0], "effort")
            ) {
                throw CliFailure("invalid_state", "Pending claim selection differs from its declared tool")
            }

            policy.ValidateBudget(run.Seconds, run.Unlimited)
            RuntimeBudget.Validate(run)

            if run.Source == "tokate" {
                SelectionPolicy.Revalidate(run, policy)
            }

            Overlaps.RequireDependencies(run.Repo, run.Issue)
        }

        private func Accepted(
            run Data,
            viewer JsonElement,
            state CoordinationState,
            outcome CoordinationState.ResultRecord?
        ) {
            let request = run.ClaimRequest
            let uuid = CoordinatorRequest.Parse(request).Uuid
            let reservation = state.Lease

            if !LeaseLifecycle.Supported(state) ||
                (outcome?.Lease?.Lease ?? "") != uuid ||
                (outcome?.Lease?.Attempt ?? "") != uuid ||
                RepositoryIdentity.PositiveId(
                outcome?.Lease?.ActorJson ?? default(JsonElement)
            ) != RepositoryIdentity.PositiveId(J.Get(viewer, "id")) ||
                (outcome?.Reservation ?? "") != (reservation?.Reservation ?? "") ||
                (reservation?.Lease ?? "") != uuid ||
                (reservation?.Attempt ?? "") != uuid {
                throw CliFailure("stale_approval", "Exact claim outcome no longer owns the active lease or attempt")
            }

            state.Reservation(J.Get(viewer, "id"))
            LeaseLifecycle.Fence(state, uuid)
            CheckPending(run, viewer, state)
            ContributionHandoff.Authority(state, ContributionHandoff.Declaration(run.Handoff))

            if state.Contribution != nil {
                throw CliFailure("invalid_state", "Published work is preserved; this claim cannot prepare new coding")
            }
        }

        private func Pending(directory string, run Data, args Args) string {
            let viewer = GitHub.Api("user")
            let repo = RepositoryIdentity.Repo(run.Repo)
            let issue = run.Issue
            let request = run.ClaimRequest
            let declaration = CoordinatorRequest.Parse(request)

            if !RepositoryIdentity.SameDonor(viewer, run) {
                throw CliFailure(
                    "authentication_required",
                    "Active GitHub account differs from the saved pending donor; no request posted"
                )
            }

            if args.Get("run") != "" {
                CheckPending(run, viewer, CoordinationState.Load(repo, issue))
            }

            Submission.Request(repo, issue, request, Path.Combine(directory, "claim.posting.json"), J.Get(viewer, "id"))

            ApiTransport.BeginDeadline(
                Output.Sink.Donating ? args.Number("seconds"): ApiTransport.DefaultDeadlineSeconds
            )

            var accepted CoordinationState? = nil

            try {
                while true {
                    ApiTransport.CheckDeadline()
                    if Output.Sink.Donating {
                        Submission.ResetWorkflow()
                        if let guidance = Submission.PendingWorkflow(directory, run) {
                            if guidance["role"]?.ToString() == "owner" {
                                throw CliFailure("command_failed", "Owner workflow failed")
                            }
                        }
                    }
                    let state = CoordinationState.Load(repo, issue)

                    if state.ApprovalId != run.Approval {
                        throw CliFailure(
                            "stale_approval",
                            "Pending claim approval changed; original request is preserved"
                        )
                    }

                    let outcome = RequestMetadata.Recorded(
                        state,
                        RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                        request
                    )
                    if outcome != nil {
                        accepted = state
                        break
                    }

                    if state.Sha != declaration.Expected {
                        throw CliFailure(
                            "invalid_state",
                            "Coordination changed without this exact claim outcome; authority is unknown. Inspect the saved run and current coordination. No new request was posted."
                        )
                    }

                    ApiTransport.PollWait("repos/" + repo + "/actions/")
                }
            } catch (error ApiDeadlineException) when !Output.Sink.Donating { } finally {
                ApiTransport.EndDeadline()
            }

            if let state = accepted {
                let outcome = RequestMetadata.Recorded(
                    state,
                    RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                    request
                )
                Accepted(run, viewer, state, outcome)

                Bind(run, state)

                WorkspacePreparation.Select(run, run.RequestedFork)
                WorkspacePreparation.Promote(directory, run, state.Approval?.Base ?? "")
                Complete(directory, run)
            } else {
                Output.Sink.ResultData = Output.Sink.RunSummary(directory)
                if let guidance = Submission.PendingWorkflow(directory, run) {
                    Output.Sink.Message(guidance["action"]?.ToString() ?? "")
                    return directory
                }
                Output.Sink.Message(
                    "Claim pending. Run: " +
                        directory +
                        "; resume explicitly with work --run DIR. If the Tokate workflow failed: " +
                        ApiTransport.MutationRecovery
                )
                Output.Sink.Actions.Add([]string{"tokate", "work", "--run", directory, "--json"})
            }

            return directory
        }
    }
}
