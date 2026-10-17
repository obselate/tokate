package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Security.Cryptography
import System.Text.Json

internal class Amendment {
    shared {
        internal func Tools(policy Policy, tools JsonElement) -> RequestMetadata.CorrectionTools(
            tools,
            policy.Value,
            "Amendment"
        )

        internal func ValidateReceipt(value JsonElement, policy Policy, head string) {
            RequestData.Keys(value, "id,previous,seconds,tools,base,summary")
            var id Guid
            let seconds = J.Number(value, "seconds")

            if !Guid.TryParseExact(J.Text(value, "id"), "D", out id) || seconds < 1 || seconds > policy.MaxSeconds {
                throw CliFailure("invalid_state", "Invalid amendment receipt or verification budget")
            }

            RepositoryIdentity.CommitSha(J.Text(value, "previous"))
            let summary = J.Get(value, "summary")

            if summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(summary, head)
            }

            Tools(policy, J.Get(value, "tools"))

            if J.Get(value, "base").ValueKind != JsonValueKind.Undefined {
                RepositoryIdentity.CommitSha(J.Text(value, "base"))
            }
        }

        internal func Pull(run Data, number int32, previous string, candidate string) JsonElement {
            let pull = GitHub.Api("repos/" + run.Repo + "/pulls/" + number.ToString())
            let head = J.Get(pull, "head")
            let base = J.Get(pull, "base")
            let headRepo = J.Text(J.Get(head, "repo"), "full_name")
            let mergedAt = J.Get(pull, "merged_at").ValueKind
            let marker = RequestData.OwnershipMarkerPrefix + run.Id + " -->"
            let failure = "Existing PR changed, closed or merged; saved amendment retained"

            let baseRepo = J.Text(J.Get(base, "repo"), "full_name")
            let headSha = J.Text(head, "sha")
            if J.Number(pull, "number") != number || J.Text(pull, "state") != "open" || J.Bool(pull, "merged") ||
                (mergedAt != JsonValueKind.Undefined && mergedAt != JsonValueKind.Null) ||
                !J
                .Text(pull, "body").Contains(marker) || J.Text(head, "ref") != run.Branch ||
                !RepositoryIdentity.SameRepo(headRepo, run.HeadRepo) || J.Text(base, "ref") != run.BaseBranch ||
                (baseRepo != "" && !RepositoryIdentity.SameRepo(baseRepo, run.Repo)) ||
                (headSha != previous && headSha != candidate) {
                throw CliFailure("stale_approval", failure)
            }

            return pull
        }

        internal func Authority(run Data, amendment Data?, resume bool = false, directory string = "") JsonElement {
            let viewer = GitHub.Api("user")

            if !RepositoryIdentity.SameDonor(viewer, run) {
                throw CliFailure("authentication_required", "Use the same donor account and numeric identity")
            }

            if run.Version != 2 {
                throw CliFailure("invalid_state", "Amend requires a current contribution")
            }

            RepositoryAccess.ValidateRun(run)
            let state = CoordinationState.Load(run.Repo, run.Issue)
            let reservation = state.Lease

            state.Reservation(J.Get(viewer, "id"))
            let record = state.Check(run.Repo, run.Issue, run.Donor, J.Get(viewer, "id"))

            let original = state.Contribution
            let correcting = (amendment?.Uuid ?? "") != "" ||
                (amendment == nil && run.Pr == 0 && run.State != "published" && original == nil)

            if correcting {
                return CorrectionAuthority(run, amendment, directory, record, state, viewer, original)
            }

            let metadata = original?.Metadata ?? default(JsonElement)
            let publication = PublicationRequestMetadata.Parse(metadata)
            let approval = OwnerApproval.Record.Parse(J.Get(record, "approval"))
            let actor = J.Get(viewer, "id").ToString()
            let originalActor = (original?.ActorJson ?? default(JsonElement)).ToString()
            let reservationId = reservation?.Reservation ?? ""
            let declaredAttempt = amendment?.Attempt ?? ""
            let attempt = declaredAttempt != "" ? declaredAttempt:
            (run.PublicationAttempt == "" ? run.Attempt: run.PublicationAttempt)

            if !(resume && amendment == nil) && attempt != (reservation?.Attempt ?? "") {
                throw CliFailure("stale_approval", "Saved amendment attempt fence changed")
            }

            let failure = "Published contribution authority changed"
            if state.ApprovalId != run.Approval ||
                reservationId != run.Id ||
                originalActor != actor ||
                !RepositoryIdentity.SameRepo(publication.Fork, run.HeadRepo) ||
                publication.Branch != run.Branch ||
                run.Branch != GitHub.ContributionBranchPrefix +
                run.Id ||
                run.Base != (reservation?.Base ?? "") ||
                run.BaseBranch != approval.BaseBranch ||
                run.PolicyHash != approval.PolicyHash {
                throw CliFailure("stale_approval", failure)
            }

            if amendment != nil && state.Sha != amendment.Expected {
                let current = state.Current()
                let outcome = current?.Outcome
                let stale = "Amendment has stale coordination revision"
                if (current?.Request ?? "") != amendment.Id ||
                    (current?.Expected ?? "") != amendment.Expected ||
                    (outcome?.Head ?? "") != amendment.Commit ||
                    (outcome?.Pr ?? 0) != amendment.Pr ||
                    (current?.ActorJson ?? default(JsonElement)).ToString() != actor {
                    throw CliFailure("stale_approval", stale)
                }
                if (current?.Previous ?? "") != amendment.Previous ||
                    (current?.Seconds ?? 0) != amendment.Seconds ||
                    !RequestData.Same(current?.Tools ?? default(JsonElement), amendment.Tools) ||
                    (current?.Base ?? "") != amendment.Base ||
                    (current?.HasBase ?? false) != amendment.HasBase {
                    throw CliFailure("stale_approval", stale)
                }

                Transition(run.Repo, state, amendment.Expected)
            } else if state.Head() != (amendment?.Previous ?? run.Commit) {
                throw CliFailure("stale_approval", "Current published head differs from saved contribution")
            }

            let remoteHead = Remote(run, amendment?.Previous ?? run.Commit, amendment?.Commit ?? "")

            RepositoryAccess.ValidateFork(
                run.Repo,
                run.HeadRepo,
                run.Branch,
                remoteHead,
                RepositoryIdentity.PositiveId(J.Get(viewer, "id"))
            )

            return J.Parse(J.Write(map[string, Object?]{"record": record, "state": state.Value(), "sha": state.Sha}))
        }

        private func CorrectionAuthority(
            run Data,
            amendment Data?,
            directory string,
            record JsonElement,
            state CoordinationState,
            viewer JsonElement,
            original CoordinationState.PublicationRecord?
        ) JsonElement {
            if directory != "" {
                OriginalEvidence.Pinned(directory, run, record)
            }

            ContributionAuthority.Recheck(run)
            let intent = amendment?.Publication ?? default(JsonElement)

            if intent.ValueKind == JsonValueKind.Object && state.Sha != amendment?.Expected {
                let request = J.Get(intent, "request")
                let outcome = RequestMetadata.Recorded(
                    state,
                    RepositoryIdentity.PositiveId(J.Get(viewer, "id")),
                    request
                )
                Transition(run.Repo, state, amendment?.Expected ?? "")
                if (original?.Request ?? "") != amendment?.PublicationUuid ||
                    (original?.Expected ?? "") != amendment?.Expected ||
                    (original?.ActorJson ?? default(JsonElement)).ToString() != J.Get(viewer, "id").ToString() ||
                    !RequestData.Same(request, Submission.PublicationRequest(run, amendment)) || !RequestData.Same(
                    original?.Metadata ?? default(JsonElement),
                    CoordinatorRequest.Parse(request).Metadata
                ) ||
                    outcome == nil ||
                    !RequestData
                    .Same(outcome.Value(), original?.Outcome.Value() ?? default(JsonElement)) {
                    throw CliFailure(
                        "stale_approval",
                        "Stale coordination revision; only the exact saved publication transition can resume"
                    )
                }
            } else if original != nil {
                throw CliFailure("invalid_state", "Contribution already published")
            }

            UnpublishedRemote(
                run,
                amendment,
                intent.ValueKind == JsonValueKind.Undefined || J.Text(intent, "stage") == "prepared"
            )
            return J.Parse(J.Write(map[string, Object?]{"record": record, "state": state.Value(), "sha": state.Sha}))
        }

        private func Transition(repo string, state CoordinationState, expected string) {
            let revision = state.PublicationRevision
            let commit = GitHub.Api("repos/" + repo + "/git/commits/" + (revision == "" ? state.Sha: revision))
            let parents = J.Items(J.Get(commit, "parents"))
            if parents.Count != 1 || J.Text(parents[0], "sha") != expected {
                throw CliFailure("stale_approval", "Amendment state is not the exact saved coordination transition")
            }
        }

        private func Snapshot(
            checkout string,
            run Data,
            commit string,
            previous string,
            record JsonElement,
            baseline string
        ) string {
            let policy = J.Get(record, "policy")
            let approval = J.Get(record, "approval")

            Verification.Candidate(checkout)

            if Commands.Git(checkout, "rev-parse", "HEAD") != commit || Commands.Git(
                checkout,
                "status",
                "--porcelain",
                "--untracked-files=all",
                "--ignore-submodules=none"
            ) != "" {
                throw CliFailure("invalid_state", "Amend requires a clean checkout at the declared exact commit")
            }

            Commands.Git(checkout, "merge-base", "--is-ancestor", run.Base, commit)
            if previous != "" {
                Commands.Git(checkout, "merge-base", "--is-ancestor", previous, commit)
            }

            if previous != "" && Commands.Git(checkout, "rev-parse", commit + "^{tree}") == Commands.Git(
                checkout,
                "rev-parse",
                previous + "^{tree}"
            ) {
                throw CliFailure(
                    "invalid_state",
                    "The commit has no file changes compared with the published commit. Edit and commit the saved checkout first."
                )
            }

            Commands.Git(checkout, "diff", "--no-ext-diff", "--no-textconv", "--check", baseline, commit)

            for name in[]string{"MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"} {
                if File.Exists(Path.Combine(checkout, ".git", name)) {
                    throw CliFailure(
                        "invalid_state",
                        "Unresolved or ambiguous conflict operation; preserve evidence and commit an owner-reviewed resolution"
                    )
                }
            }

            ProtectedPaths.Local(checkout, policy, approval, baseline, commit)

            if previous != "" {
                return Commands.Git(checkout, "rev-parse", "HEAD^{tree}") + "\n" + Commands.GitRaw(
                    checkout,
                    []string{"diff", "--no-ext-diff", "--no-textconv", "--binary", baseline, commit}
                )
            }
            return Commands.GitRaw(
                checkout,
                []string{
                    "diff",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--binary",
                    "--full-index",
                    "--find-renames=100%",
                    baseline,
                    commit,
                    "--"
                }
            )
        }

        internal func Run(args Args) {
            try {
                let directory = Path.GetFullPath(args.Need("run"))
                using let lease = RunStorage.Lease(directory)
                AmendSaved(args, directory, Data.Load(directory))
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        private func AmendSaved(args Args, directory string, run Data) {
            let live = CoordinationState.Load(run.Repo, run.Issue)
            live.Reservation(J.Parse(J.Write(run.DonorId)))
            let savedCorrection = run.Amendment != ""
            let correcting = run.Pr == 0 && run.State != "published" && (savedCorrection || live.Contribution == nil)
            let continuing = args.Get("commit") == "" && args.Get("seconds") == ""
            if correcting && PrepareCorrection(args, directory, run, savedCorrection, continuing, live) {
                return
            }
            let coding = run.Source == "external"
            let checkout = Path.Combine(directory, "checkout")
            let source = coding ? Path.Combine(directory, "coding"): checkout
            if !continuing && args.Get("commit") == "" {
                args.Values["--commit"] = Commands.Git(source, "rev-parse", "HEAD")
            }

            if continuing {
                SelectSavedAmendment(args, directory, run)
            }

            let commit = RepositoryIdentity.CommitSha(args.Need("commit"))
            let current = Path.Combine(directory, "amendments", commit, "run.json")
            var change = File.Exists(current) ? Data.Read(current): Data()

            if !correcting && change.Uuid != "" {
                change = Data()
            }

            let saved = change.Commit == commit

            if !saved && change.Publication.ValueKind == JsonValueKind.Object {
                throw CliFailure(
                    "invalid_state",
                    "Interrupted publication intent already binds another candidate; inspect it before any new correction"
                )
            }

            if saved {
                OriginalEvidence.Amended(directory, run, change)
                if !continuing {
                    Inputs(args, change, commit, correcting)
                }
            } else {
                change = CreateAmendment(args, directory, run, commit, correcting, coding, source, checkout)
            }

            if change.State == "failed" || change.State == "verifying" {
                throw CliFailure(
                    "verification_failed",
                    "Amendment verification failed or interrupted; inspect saved progress and declare a corrected commit"
                )
            }

            if correcting {
                Activate(directory, run, change)
            }

            PublishSaved(directory, run, change)
        }

        private func PrepareCorrection(
            args Args,
            directory string,
            run Data,
            savedCorrection bool,
            continuing bool,
            state CoordinationState
        ) bool {
            Completed(directory, run)

            if args.Get("resume") != "" {
                throw CliFailure("invalid_state", "Resume requires a published PR")
            }

            let existing = savedCorrection ? Data.Load(
                Path.Combine(directory, "amendments", run.Amendment),
                amendment: true
            ): nil

            if existing != nil && continuing && existing.Publication.ValueKind == JsonValueKind.Object {
                PublishSaved(directory, run, existing)
                return true
            }

            let record = J.Get(Authority(run, continuing ? existing: nil, directory: directory), "record")

            if (existing?.Publication ?? default(JsonElement)).ValueKind != JsonValueKind.Object {
                Publication.Find(run, default(JsonElement), newIntent: state.Contribution == nil)
            }

            if !continuing || existing != nil {
                OriginalEvidence.Load(directory, run)
            }

            if continuing {
                OriginalEvidence.Capture(directory, run, record)

                for key in[]string{"tools", "summary"} {
                    if args.Get(key) != "" {
                        args.Need("seconds")
                    }
                }

                Output.Sink.Message(
                    "Original evidence preserved. Edit and commit the checkout, then amend --time TIME. No inference, checks or publication ran."
                )
                return true
            }

            return false
        }

        private func SelectSavedAmendment(args Args, directory string, run Data) {
            for key in[]string{"tools", "summary", "resume"} {
                if args.Get(key) != "" {
                    args.Need("commit")
                }
            }

            let amendments = Path.Combine(directory, "amendments")

            if Directory.Exists(amendments) {
                for saved in Directory.EnumerateDirectories(amendments) {
                    if !File.Exists(Path.Combine(saved, "run.json")) {
                        continue
                    }
                    let value = Data.Load(saved, amendment: true)

                    if value.Previous != run.Commit || value.Request.ValueKind != JsonValueKind.Object {
                        continue
                    }

                    if args.Get("commit") != "" {
                        throw CliFailure(
                            "invalid_state",
                            "Multiple saved amendment requests. Select one with --commit and --time."
                        )
                    }
                    args.Values["--commit"] = value.Commit
                }
            }

            if args.Get("commit") == "" {
                throw CliFailure("invalid_state", "No saved amendment request. Start a new amendment with --time.")
            }
        }

        private func CreateAmendment(
            args Args,
            directory string,
            run Data,
            commit string,
            correcting bool,
            coding bool,
            source string,
            checkout string
        ) Data {
            let seconds = args.Number("seconds")
            let tools = args.Get("tools") == "" ? J.Parse("[]"): RequestData.FileData(
                args.Need("tools"),
                correcting ? RequestData.CorrectionToolsByteLimit: RequestData.RequestByteLimit
            )
            let summary = PublicSummary.FileSummary(args.Get("summary"), commit)
            let published = run.Commit
            let authority = Authority(run, nil, args.Get("resume") == "true", directory: directory)
            let record = J.Get(authority, "record")
            let policy = Policy(J.Write(J.Get(record, "policy")))
            Tools(policy, tools)

            if seconds > policy.MaxSeconds {
                throw CliFailure("stale_approval", "Amendment verification budget exceeds owner policy")
            }

            let coordination = CoordinationState.Parse(J.Get(authority, "state"))
            let number = correcting ? 0: coordination.Current()?.Outcome.Pr ?? 0
            let pull = correcting ? default(JsonElement): Pull(run, number, published, "")

            if !correcting {
                ReceiptVerification.Verify(run.Repo, number, pull)
                Remote(run, published, "")
            }

            if coding {
                let baseline = GitHubPathEvidence.LocalBase(
                    source,
                    run.Repo,
                    J.Get(record, "approval"),
                    commit,
                    J.Text(record, "base")
                )
                Snapshot(source, run, commit, published, record, baseline)
                Commands.Git(
                    checkout,
                    "-c",
                    "protocol.file.allow=always",
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-recurse-submodules",
                    "--",
                    source,
                    commit
                )
                Commands.Git(checkout, "checkout", "--quiet", "--detach", commit)
            }

            let baseline = correcting ? run.Base: GitHubPathEvidence.LocalBase(
                checkout,
                run.Repo,
                J.Get(record, "approval"),
                commit,
                J.Text(record, "base")
            )
            let accepted = correcting ? "": Snapshot(checkout, run, commit, run.Commit, record, baseline)
            let archive = OriginalEvidence.Capture(directory, run)

            let change = Data{
                Id: Guid.NewGuid().ToString("D"),
                Commit: commit,
                Seconds: seconds,
                Tools: tools,
                Previous: correcting ? "": run.Commit,
                PreviousRemote: correcting ? run.Commit: "",
                Pr: number,
                Expected: J.Text(authority, "sha"),
                Attempt: coordination.Lease?.Attempt ?? "",
                OriginalEvidenceSha256: archive,
                FailureStage: "candidate_validation",
                FailureReason: "candidate_invalid"
            }

            change.Transition("validating")
            if correcting {
                change.Version = 1
                change.Uuid = change.Id
            }

            if baseline != run.Base {
                change.Base = baseline
            }

            if summary.ValueKind != JsonValueKind.Undefined {
                change.PublicSummary = summary
            }

            RecordInputFiles(args, change)

            change.PreviousBody = J.Text(pull, "body")

            VerifyCandidate(directory, run, change, checkout, commit, record, baseline, correcting, accepted)

            return change
        }

        private func RecordInputFiles(args Args, change Data) {
            for key in[]string{"tools", "summary"} {
                if args.Get(key) != "" {
                    if key == "tools" {
                        change.ToolsArgument = Path.GetFullPath(args.Get(key))
                        change.ToolsSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args.Need(key))))
                    } else {
                        change.SummaryArgument = Path.GetFullPath(args.Get(key))
                        change.SummarySha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(args.Need(key))))
                    }
                }
            }
        }

        private func VerifyCandidate(
            directory string,
            run Data,
            change Data,
            checkout string,
            commit string,
            record JsonElement,
            baseline string,
            correcting bool,
            accepted string
        ) {
            let location = Location(directory, change)
            Directory.CreateDirectory(location)
            try {
                let snapshot = correcting ? Snapshot(checkout, run, commit, "", record, baseline): accepted

                if correcting {
                    change.Tree = Commands.Git(checkout, "rev-parse", "HEAD^{tree}")
                }

                if correcting {
                    change.PatchSha256 = J.Hash(snapshot)
                } else {
                    change.Snapshot = J.Hash(snapshot)
                }
                File.WriteAllText(Path.Combine(location, "candidate.patch"), snapshot)

                File.WriteAllText(
                    Path.Combine(location, "conflict-evidence.txt"),
                    Commands.Git(checkout, "show", "--format=raw", "--cc", "--no-ext-diff", "--no-textconv", commit)
                )

                Save(directory, change)
                Verify(directory, run, change, record)
            } catch (error Exception) when ExecutionFailure.Handled(error) {
                change.Transition("failed")
                change.Error = error.Message
                Save(directory, change)

                let failure = ExecutionFailure.From(
                    error,
                    change.FailureReason == "verification_failed" ? "verification_failed": "invalid_state"
                )

                throw CliFailure(
                    failure.Code,
                    Output
                        .Sink
                        .Enabled ? failure.Message: change.FailureReason +
                        " (" +
                        change.FailureStage +
                        "): " +
                        error.Message,
                    summary: failure.Summary
                )
            }
        }

        private func Inputs(args Args, change Data, commit string, correcting bool) {
            for key in[]string{"seconds", "tools", "summary"} {
                try {
                    let input = switch key {
                        case "seconds": J.Parse(args.Number(key).ToString())
                        case "tools": args.Get(key) == "" ? J.Parse("[]"): RequestData.FileData(
                            args.Need(key),
                            correcting ? RequestData.CorrectionToolsByteLimit: RequestData.RequestByteLimit
                        )
                        default: PublicSummary.FileSummary(args.Get(key), commit)
                    }
                    let same = RequestData.Same(
                        J.Get(change.Element(), key == "summary" ? "public_summary": key),
                        input
                    )
                    let hash = key == "tools" ? change.ToolsSha256: key == "summary" ? change.SummarySha256: ""
                    if !same ||
                        (
                        hash != "" && args.Get(key) != "" && hash != Convert.ToHexString(
                            SHA256.HashData(File.ReadAllBytes(args.Need(key)))
                        )
                    ) {
                        throw CliFailure("invalid_state", "Changed amendment input")
                    }
                } catch (error Exception) when error is CliFailure ||
                    error is IOException ||
                    error is UnauthorizedAccessException ||
                    error is JsonException ||
                    error.GetType() == typeof(Exception) {
                    throw CliFailure(
                        "invalid_state",
                        "Saved amendment " + Args.Label(key) +
                            " input differs or cannot be read. Restore the original input to continue, or start a new amendment with a new --commit and --time."
                    )
                }
            }
        }

        private func Location(directory string, change Data) string -> Path.Combine(
            directory,
            "amendments",
            change.Commit
        )

        private func Save(directory string, change Data) {
            change.Save(Location(directory, change))
            if change.Uuid != "" {
                let run = Data.Load(directory)
                run.Amendment = change.Commit
                run.Save(directory)
            }
        }

        private func Exact(directory string, run Data, change Data, record JsonElement) string {
            let checkout = Path.Combine(directory, "checkout")
            let snapshot = Snapshot(
                checkout,
                run,
                change.Commit,
                change.Previous,
                record,
                change.Base == "" ? run.Base: change.Base
            )
            let correcting = change.Uuid != ""
            let patch = File.ReadAllText(Path.Combine(Location(directory, change), "candidate.patch"))
            if (correcting && Commands.Git(checkout, "rev-parse", "HEAD^{tree}") != change.Tree) || J.Hash(
                snapshot
            ) != (correcting ? change.PatchSha256: change.Snapshot) ||
                snapshot != patch {
                throw CliFailure("invalid_state", "Verified amendment candidate changed")
            }
            return snapshot
        }

        private func Verify(directory string, run Data, change Data, record JsonElement) {
            let location = Location(directory, change)
            let checkout = Path.Combine(directory, "checkout")
            let results = List[Object]()
            let timer = Stopwatch.StartNew()
            let seconds = change.Seconds
            change.Verification = J.Parse(J.Write(results))
            change.Transition("verifying")
            change.FailureStage = "owner_verification"
            change.FailureReason = "verification_failed"
            Save(directory, change)
            Output.Sink.FailureCode = "verification_failed"
            Output.Sink.Step("Verifying the exact amendment independently. No inference will run.")
            let budget = RuntimeBudget(timer, seconds)
            {
                using let workspace = VerificationWorkspace.Create(checkout, budget)
                for command in J.Items(Policy.Parse(J.Get(record, "policy")).Verification) {
                    let remaining = seconds - Convert.ToInt32(timer.Elapsed.TotalSeconds)
                    if remaining < 1 {
                        throw CliFailure("verification_failed", "Amendment verification budget exhausted")
                    }
                    Save(directory, change)
                    var result CommandResult
                    try {
                        result = Verification.Verify(
                            location,
                            results,
                            command,
                            checkout,
                            remaining,
                            budget: budget,
                            workspace: workspace
                        )
                    } finally {
                        change.Verification = J.Parse(J.Write(results))
                    }
                    Save(directory, change)
                    if result.Code != 0 && change.Uuid == "" {
                        throw CliFailure(
                            "verification_failed",
                            "Amendment owner verification failed; saved progress retained"
                        )
                    }
                }
                Output.Sink.FailureCode = "invalid_state"
                change.FailureStage = "changed_candidate"
                change.FailureReason = "candidate_changed"
                workspace.Unchanged(budget)
            }
            Exact(directory, run, change, record)
            let elapsed = Convert.ToInt32(timer.Elapsed.TotalSeconds)

            if change.Uuid != "" {
                change.VerificationSeconds = elapsed
            } else {
                change.ElapsedSeconds = elapsed
            }
            change.FailureStage = "owner_verification"
            change.FailureReason = "verification_failed"
            Output.Sink.FailureCode = "verification_failed"
            Verification.Results(change, Policy.Parse(J.Get(record, "policy")).Verification)
            change.Transition("verified")
            change.ClearFailureStage()
            change.ClearFailureReason()
            Save(directory, change)
        }

        internal func Remote(run Data, previous string, candidate string) string {
            let reference = GitHub.Api("repos/" + run.HeadRepo + "/git/ref/heads/" + run.Branch)
            let head = J.Text(J.Get(reference, "object"), "sha")

            if head != previous && head != candidate {
                throw CliFailure("stale_approval", "Remote PR branch changed; saved amendment retained")
            }

            return head
        }

        internal func PublishSaved(directory string, run Data, amendment Data? = nil) {
            let change = amendment ?? Data.Load(Path.Combine(directory, "amendments", run.Amendment), amendment: true)
            let location = Location(directory, change)
            try {
                OriginalEvidence.Amended(directory, run, change)
                let authority = Authority(run, change, directory: directory)
                let record = J.Get(authority, "record")
                let policy = Policy(J.Write(J.Get(record, "policy")))
                if change.Uuid != "" {
                    Completed(Path.Combine(directory, "original-evidence"), OriginalEvidence.Load(directory, run))
                    RequestMetadata.CorrectionTools(change.Tools, policy.Value)
                    if change.State != "verified" || run.Commit != change.Commit || !RequestData.Same(
                        run.Correction,
                        Provenance(change)
                    ) ||
                        !RequestData
                        .Same(run.Verification, change.Verification) {
                        throw CliFailure("invalid_state", "Only the saved verified exact correction can be published")
                    }
                } else {
                    Tools(policy, change.Tools)
                }
                if change.Seconds < 1 || change.Seconds > policy.MaxSeconds {
                    throw CliFailure("stale_approval", "Amendment budget exceeds current owner policy")
                }
                Verification.Results(change, policy.Verification)
                let snapshot = Exact(directory, run, change, record)
                if change.Uuid != "" {
                    PublishCorrection(directory, run, change, record)
                } else {
                    Publish(directory, location, run, change, authority, snapshot)
                }
            } catch (error Exception) when ExecutionFailure.Handled(error) {
                change.Error = error.Message
                change.FailureReason = error is CliFailure failure ? failure.Code: "publication_interrupted"
                Save(directory, change)
                if error is CliFailure {
                    throw error
                }
                throw CliFailure(
                    "command_failed",
                    error.Message +
                        " Saved amendment retained. Re-run the same amend command to continue only the saved publication intent after inspection.",
                    summary: CliFailure.Message("command_failed")
                )
            }
        }

        private func Publish(
            directory string,
            location string,
            run Data,
            amendment Data,
            authority JsonElement,
            snapshot string
        ) {
            let record = J.Get(authority, "record")
            let checkout = Path.Combine(directory, "checkout")
            let published = amendment.Previous
            let pull = Pull(run, amendment.Pr, published, amendment.Commit)
            let remote = Remote(run, published, amendment.Commit)

            if J.Text(J.Get(pull, "head"), "sha") != remote {
                throw CliFailure("stale_approval", "Remote branch and PR head disagree")
            }

            let receipt = PrBody.Receipt(J.Text(pull, "body"))
            let previousReceipt = PrBody.Receipt(amendment.PreviousBody)

            if amendment.State == "verified" {
                PreparePublication(
                    location,
                    run,
                    amendment,
                    authority,
                    pull,
                    remote,
                    published,
                    receipt,
                    previousReceipt
                )
            }

            let previousOwned = PrBody.Owned(amendment.PreviousBody)
            let owned = PrBody.Owned(J.Text(pull, "body"))

            if owned != previousOwned && owned != PrBody.Owned(amendment.Body) {
                throw CliFailure("stale_approval", "PR owned regions differ from saved previous or candidate state")
            }

            if remote == published {
                if RequestData.Canonical(receipt.ToJson()) != RequestData.Canonical(previousReceipt.ToJson()) ||
                    owned != previousOwned {
                    throw CliFailure(
                        "stale_approval",
                        "Invalid physical state: candidate receipt on the previous remote head"
                    )
                }

                Authority(run, amendment, directory: directory)
                Pull(run, amendment.Pr, published, "")
                Remote(run, published, "")

                if Exact(directory, run, amendment, record) != snapshot {
                    throw CliFailure("invalid_state", "Amendment checkout changed before push")
                }

                Access(run, record)

                Publication.Push(checkout, run, amendment.Commit)
            }

            Authority(run, amendment, directory: directory)

            Remote(run, amendment.Commit, "")

            let latest = Pull(run, amendment.Pr, amendment.Commit, "")

            GitHubPathEvidence.Amendment(
                run.Repo,
                record,
                AmendmentRequestMetadata.Parse(CoordinatorRequest.Parse(amendment.Request).Metadata)
            )

            Authority(run, amendment, directory: directory)

            if J.Text(authority, "sha") != amendment.Expected {
                ReceiptVerification.Verify(run.Repo, amendment.Pr)

                Complete(directory, location, run, amendment, latest)
                return
            }

            let request = amendment.Request
            let path = Path.Combine(location, "request.json")

            File.WriteAllText(path, CoordinatorRequest.Parse(request).ToJson() + "\n")

            if amendment.State != "requested" {
                Submission.Request(Args([]string{"request", run.Repo + "#" + run.Issue.ToString(), "--file", path}))

                Authority(run, amendment, directory: directory)

                amendment.Transition("requested")

                amendment.Save(location)
            }

            Output.Sink.Message(
                "Amendment request saved. Await coordinator outcome, then repeat amend. The PR receipt is invalid until body and coordination state agree."
            )
        }

        private func PreparePublication(
            location string,
            run Data,
            amendment Data,
            authority JsonElement,
            pull JsonElement,
            remote string,
            published string,
            receipt ContributionReceipt.Record,
            previousReceipt ContributionReceipt.Record
        ) {
            if remote != published || receipt.Head != amendment.Previous {
                throw CliFailure("stale_approval", "Remote changed before amendment publication intent")
            }

            if RequestData.Canonical(receipt.ToJson()) != RequestData.Canonical(previousReceipt.ToJson()) {
                throw CliFailure("stale_approval", "Previous receipt changed after amendment acceptance")
            }

            let intent = map[string, Object?]{
                "previous": amendment.Previous,
                "head": amendment.Commit,
                "pr": amendment.Pr,
                "uuid": amendment.Id
            }

            amendment.Publication = J.Parse(J.Write(intent))

            let updatedReceipt = Receipt(receipt.ToJson(), amendment, amendment.Commit, amendment.Expected)

            let original = CoordinationState.Parse(J.Get(authority, "state")).Contribution

            let metadata = PublicSummary.Attach(
                map[string, Object?]{
                    "fork": run.HeadRepo,
                    "branch": run.Branch,
                    "previous": amendment.Previous,
                    "head": amendment.Commit,
                    "attempt": amendment.Attempt == "" ? run.Attempt: amendment.Attempt,
                    "pr": amendment.Pr,
                    "seconds": amendment.Seconds,
                    "tools": amendment.Tools,
                    "verification": RequestData.ReportedVerification
                },
                amendment.PublicSummary
            )

            amendment.Body = PrBody.ReplaceBody(
                J.Text(pull, "body"),
                PrBody.PublicReport(J.Parse(J.Write(metadata)), original?.Metadata ?? default(JsonElement)),
                updatedReceipt
            )

            if amendment.Base != "" {
                metadata["base"] = amendment.Base
            }

            let request = CoordinatorRequest(
                amendment.Id,
                amendment.Expected,
                run.Approval,
                "amend",
                J.Parse(J.Write(metadata))
            )
            amendment.Request = J.Parse(request.ToJson())

            amendment.Transition("publishing")

            amendment.Save(location)

            File.WriteAllText(Path.Combine(location, "publication.json"), amendment.ToJson() + "\n")
        }

        internal func Completed(directory string, run Data) Dictionary[string, Object?] {
            let state = run.State
            if run.Version != 2 || run.Source != "tokate" || run.Pr != 0 || state == "published" {
                throw CliFailure(
                    "invalid_state",
                    "Correction requires unpublished managed work; external work uses external --run"
                )
            }

            let reason = run.FailureReason

            if (state != "failed" && state != "generated") ||
                reason == "inference_failed" ||
                reason == "inference_interrupted" ||
                run.OutputTruncated ||
                run
                .Error
                .StartsWith("Codex failed.") || (run.HasInferenceExitCode && run.InferenceExitCode != 0) {
                throw CliFailure(
                    "invalid_state",
                    "incomplete_turn: correction requires a completed successful inference turn"
                )
            }

            try {
                let evidence = CodexEvidence.Completed(File.ReadAllText(Path.Combine(directory, "events.jsonl")))
                File.WriteAllText(Path.Combine(directory, "report.md"), evidence.Report)
                return evidence.Usage
            } catch (error Exception) when error is CliFailure ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw CliFailure("invalid_state", "incomplete_turn: " + error.Message)
            }
        }

        private func Activate(directory string, run Data, correction Data) {
            run.Commit = correction.Commit
            run.Verification = correction.Verification
            let summary = correction.PublicSummary

            if summary.ValueKind == JsonValueKind.Undefined {
                run.ClearPublicSummary()
            } else {
                run.PublicSummary = summary
            }

            run.ClearSummaryPatchSha256()
            run.Correction = Provenance(correction)
            run.Amendment = correction.Commit
            run.Transition("generated")
            run.ClearError()
            run.ClearFailureReason()
            run.ClearFailureStage()

            run.Save(directory)
        }

        internal func Provenance(correction Data) JsonElement -> J.Parse(
            J.Write(
                map[string, Object?]{
                    "uuid": correction.Uuid,
                    "head": correction.Commit,
                    "tree": correction.Tree,
                    "patch_sha256": correction.PatchSha256,
                    "seconds": correction.Seconds,
                    "tools": correction.Tools,
                    "verification": RequestData.ObservedVerification
                }
            )
        )

        private func UnpublishedRemote(run Data, correction Data?, initial bool = false) string {
            let reference = GitHub.Api(
                "repos/" + RepositoryIdentity.Repo(run.HeadRepo) + "/git/ref/heads/" + run.Branch,
                missing: true
            )

            if reference.ValueKind == JsonValueKind.Undefined {
                if initial {
                    return ""
                }

                throw CliFailure(
                    "invalid_state",
                    "interrupted_publication: contribution branch is missing; intent preserved"
                )
            }

            let head = J.Text(J.Get(reference, "object"), "sha")

            if head != run.Base &&
                head != run.Commit &&
                head != (correction?.PreviousRemote ?? "") &&
                head != (correction?.Commit ?? "") {
                throw CliFailure(
                    "invalid_state",
                    "interrupted_publication: remote branch changed; refusing to overwrite it"
                )
            }

            return head
        }

        private func Access(run Data, record JsonElement, current bool = false) {
            let approval = J.Get(record, "approval")
            let policy = current ? ApprovalBase.Check(run.Repo, approval, true).Item1.Value: J.Get(record, "policy")
            AccessState.Check(run.Repo, run.Issue, approval, J.Parse(J.Write(run.DonorId)), policy)
        }

        private func PublishCorrection(directory string, run Data, change Data, record JsonElement) {
            var intent = change.Publication
            if intent.ValueKind == JsonValueKind.Undefined {
                let authority = Authority(run, change, directory: directory)
                change.Expected = J.Text(authority, "sha")
                change.PublicationUuid = Guid.NewGuid().ToString("D")
                run.PublicationExpected = change.Expected
                run.Save(directory)
                let request = Submission.PublicationRequest(run, change)
                RequestData.Parse(J.Write(request), RequestData.RequestByteLimit)
                RequestMetadata.Request(request)
                for file in[]string{"request.json", "publication.json"} {
                    RunStorage.ControlFile(directory, file)
                    let previous = Path.Combine(directory, file)
                    if File.Exists(previous) {
                        File.Move(previous, Path.Combine(Location(directory, change), "previous-" + file))
                    }
                }
                change.Publication = J.Parse(J.Write(map[string, Object?]{"stage": "prepared", "request": request}))
                Save(directory, change)
                intent = change.Publication
            }
            if !RequestData.Same(J.Get(intent, "request"), Submission.PublicationRequest(run, change)) {
                throw CliFailure("stale_approval", "Saved version-2 publication intent changed")
            }
            let path = Path.Combine(directory, "request.json")
            if File.Exists(path) || FileInfo(path).LinkTarget != nil {
                Preview(path, J.Write(J.Get(intent, "request")) + "\n")
            }
            let authority = Authority(run, change, directory: directory)
            let stage = J.Text(intent, "stage")
            let remote = UnpublishedRemote(run, change, stage == "prepared")
            let receipt = ContributionReceipt.Publication(
                run.Repo,
                run.Issue,
                J.Get(intent, "request"),
                run.Id,
                run.Donor
            )
            Preview(Path.Combine(directory, "publication.json"), receipt.ToText() + "\n")
            let coordination = CoordinationState.Parse(J.Get(authority, "state"))
            let unrecorded = coordination.Contribution == nil
            let existing = Publication.Find(run, receipt.ToJson(), newIntent: unrecorded)
            if J.Text(authority, "sha") != change.Expected {
                if existing.ValueKind == JsonValueKind.Undefined ||
                    remote != change.Commit ||
                    (coordination.Contribution?.Outcome.Pr ?? 0) != J
                    .Number(existing, "number") {
                    throw CliFailure("stale_approval", "Saved coordination outcome lacks exact physical PR and branch")
                }
                SetStage(directory, change, "published")
                change.ClearFailureStage()
                change.ClearFailureReason()
                change.ClearPublicationError()
                change.ClearError()
                Save(directory, change)
                Publication.SavePr(directory, run, existing)
                return
            }
            if existing.ValueKind != JsonValueKind.Undefined && J.Text(J.Get(existing, "head"), "sha") != remote {
                throw CliFailure("stale_approval", "Physical PR and remote branch disagree")
            }
            if remote != change.Commit {
                SetStage(directory, change, "push_pending")
                Access(run, record, true)
                Publication.Push(Path.Combine(directory, "checkout"), run, change.Commit)
                if UnpublishedRemote(run, change) != change.Commit {
                    throw CliFailure("command_failed", "Corrected remote commit missing after push")
                }
                Authority(run, change, directory: directory)
            }
            if stage == "request_pending" || stage == "requested" {
                if !Submission.Posted(run.Repo, run.Issue, J.Parse(J.Write(run.DonorId)), J.Get(intent, "request")) {
                    throw CliFailure(
                        "invalid_state",
                        "interrupted_publication: saved request has no unique physical comment; refusing blind retry"
                    )
                }
                SetStage(directory, change, "requested")
                Output.Sink.Message(
                    "Exact publication request is already posted; awaiting the coordinator. No write, checks or inference repeated."
                )
                return
            }
            Exact(directory, run, change, record)
            let latest = Authority(run, change, directory: directory)
            Access(run, record, true)
            let request = Publication.Prepare(run, record, J.Get(intent, "request"), newIntent: unrecorded)
            let declaration = CoordinatorRequest.Parse(request)
            change.PublicationPr = PublicationRequestMetadata.Parse(declaration.Metadata).Pr
            change.Publication = J.Parse(J.Write(map[string, Object?]{"stage": stage, "request": request}))
            Save(directory, change)
            Preview(path, declaration.ToJson() + "\n")
            SetStage(directory, change, "request_pending")
            Submission.WriteRequest(
                run.Repo,
                run.Issue,
                J.Parse(J.Write(run.DonorId)),
                request,
                CoordinationState.Parse(J.Get(latest, "state")).Lease?.Expires ?? 0
            )
            SetStage(directory, change, "requested")
            Output.Sink.Message("Exact correction publication request posted. The coordinator must adopt the donor PR.")
        }

        private func Preview(path string, expected string) {
            if FileInfo(path).LinkTarget != nil {
                throw CliFailure("invalid_state", "Publication preview must not be a link")
            }

            if File.Exists(path) {
                let value = File.ReadAllText(path)

                if !RequestData.Same(J.Parse(value), J.Parse(expected)) {
                    throw CliFailure("invalid_state", "Saved publication preview differs from exact intent")
                }
            } else {
                File.WriteAllText(path, expected)
            }
        }

        private func SetStage(directory string, correction Data, stage string) {
            let intent = map[string, Object?]{}

            for field in correction.Publication.EnumerateObject() {
                intent[field.Name] = field.Value.Clone()
            }

            intent["stage"] = stage
            correction.Publication = J.Parse(J.Write(intent))
            Save(directory, correction)
        }

        internal func Receipt(previous JsonElement, amendment Data, head string, expected string) JsonElement {
            let fields = map[string, Object?]{}

            for field in previous.EnumerateObject() {
                fields[field.Name] = field.Value.Clone()
            }

            fields["head"] = head
            fields["expected"] = expected
            fields["amendment"] = PublicRecord(amendment)
            fields.Remove("incomplete")
            return J.Parse(J.Write(fields))
        }

        internal func PublicRecord(amendment Data) Object {
            let fields = map[string, Object?]{
                "id": amendment.Id,
                "previous": amendment.Previous,
                "seconds": amendment.Seconds,
                "tools": amendment.Tools
            }

            if amendment.Base != "" {
                fields["base"] = amendment.Base
            }

            return PublicSummary.Attach(fields, amendment.PublicSummary)
        }

        internal func Complete(directory string, location string, run Data, amendment Data, pull JsonElement) {
            amendment.Transition("published")
            amendment.ClearError()
            amendment.ClearFailureReason()

            amendment.Save(location)

            let history = J.Items(run.Amendments)
            if !history.Exists(old -> J.Text(old, "id") == amendment.Id) {
                history.Add(
                    J.Parse(
                        J.Write(
                            map[string, Object?]{
                                "id": amendment.Id,
                                "previous": amendment.Previous,
                                "head": amendment.Commit
                            }
                        )
                    )
                )
            }

            run.Amendments = J.Parse(J.Write(history))
            run.Commit = amendment.Commit

            if amendment.Attempt != "" {
                run.PublicationAttempt = amendment.Attempt
            }

            run.ClearIncomplete()

            Publication.SavePr(directory, run, pull)

            Output.Sink.Message(
                "Verified amendment published; original evidence: " + Path.Combine(directory, "original-evidence")
            )
        }
    }
}
