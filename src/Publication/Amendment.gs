package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Security.Cryptography
import System.Text.Json

internal class Amendment {
    shared {
        internal func Tools(policy Policy, tools JsonElement) -> RequestData.CorrectionTools(
            tools,
            policy.Value,
            "Amendment"
        )

        internal func ValidateReceipt(value JsonElement, policy Policy, head string) {
            RequestData.Keys(value, "id,previous,seconds,tools,base,summary")
            var id Guid
            let seconds = J.Number(value, "seconds")

            if !Guid.TryParseExact(J.Text(value, "id"), "D", out id) || seconds < 1 || seconds > J.Number(
                policy.Value,
                "max_seconds"
            ) {
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
            let pull = GitHub.Api("repos/" + run.Text("repo") + "/pulls/" + number.ToString())
            let head = J.Get(pull, "head")
            let base = J.Get(pull, "base")
            let headRepo = J.Text(J.Get(head, "repo"), "full_name")
            let mergedAt = J.Get(pull, "merged_at").ValueKind
            let marker = "<!-- tokate-v2:" + run.Text("id") + " -->"
            let failure = "Existing PR changed, closed or merged; saved amendment retained"

            let baseRepo = J.Text(J.Get(base, "repo"), "full_name")
            let headSha = J.Text(head, "sha")
            if J.Number(pull, "number") != number || J.Text(pull, "state") != "open" || J.Bool(pull, "merged") ||
                (mergedAt != JsonValueKind.Undefined && mergedAt != JsonValueKind.Null) ||
                !J
                .Text(pull, "body").Contains(marker) || J.Text(head, "ref") != run.Text("branch") ||
                !RepositoryIdentity.SameRepo(headRepo, run.Text("head_repo")) || J.Text(base, "ref") != run.Text(
                "base_branch"
            ) ||
                (baseRepo != "" && !RepositoryIdentity.SameRepo(baseRepo, run.Text("repo"))) ||
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

            if run.Number("version") != 2 {
                throw CliFailure("invalid_state", "Amend requires a current contribution")
            }

            RepositoryAccess.ValidateRun(run)
            let state = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
            let value = state.Value()
            let reservation = J.Get(value, "reservation")

            state.Reservation(J.Get(viewer, "id"))
            let record = state.Check(run.Text("repo"), run.Number("issue"), run.Text("donor"), J.Get(viewer, "id"))

            let original = J.Get(value, "contribution")
            let correcting = (amendment?.Text("uuid") ?? "") != "" ||
                (
                amendment == nil && run.Number("pr") == 0 && run.Text("state") != "published" &&
                    original.ValueKind != JsonValueKind.Object
            )

            if correcting {
                return CorrectionAuthority(run, amendment, directory, record, state, value, viewer, original)
            }

            let metadata = J.Get(original, "metadata")
            let approval = J.Get(record, "approval")
            let actor = J.Get(viewer, "id").ToString()
            let originalActor = J.Get(original, "actor").ToString()
            let reservationId = J.Text(reservation, "reservation")
            let declaredAttempt = amendment?.Text("attempt") ?? ""
            let attempt = declaredAttempt != "" ? declaredAttempt:
            (run.Text("publication_attempt") == "" ? run.Text("attempt"): run.Text("publication_attempt"))

            if !(resume && amendment == nil) && attempt != J.Text(reservation, "attempt") {
                throw CliFailure("stale_approval", "Saved amendment attempt fence changed")
            }

            let failure = "Published contribution authority changed"
            if J.Text(value, "approval_id") != run.Text("approval") || reservationId != run.Text("id") ||
                originalActor != actor ||
                !RepositoryIdentity.SameRepo(J.Text(metadata, "fork"), run.Text("head_repo")) || J.Text(
                metadata,
                "branch"
            ) != run.Text("branch") || run.Text("branch") != "tokate/v2-" + run.Text("id") || run.Text(
                "base"
            ) != J.Text(reservation, "base") || run.Text("base_branch") != J.Text(approval, "base_branch") || run.Text(
                "policy_hash"
            ) != J.Text(approval, "policy_hash") {
                throw CliFailure("stale_approval", failure)
            }

            if amendment != nil && state.Sha != amendment.Text("expected") {
                let current = CoordinationState.Current(value)
                let outcome = J.Get(current, "outcome")
                let saved = amendment.Element()
                let stale = "Amendment has stale coordination revision"
                if J.Text(current, "request") != amendment.Text("id") || J.Text(current, "expected") != amendment.Text(
                    "expected"
                ) ||
                    J.Text(outcome, "head") != amendment.Text("commit") || J.Number(outcome, "pr") != amendment.Number(
                    "pr"
                ) ||
                    J
                    .Get(current, "actor").ToString() != actor {
                    throw CliFailure("stale_approval", stale)
                }
                for key in[]string{"previous", "seconds", "tools", "base"} {
                    if !RequestData.Same(J.Get(current, key), J.Get(saved, key)) {
                        throw CliFailure("stale_approval", stale)
                    }
                }

                Transition(run.Text("repo"), state, amendment.Text("expected"))
            } else if CoordinationState.Head(value) != (amendment?.Text("previous") ?? run.Text("commit")) {
                throw CliFailure("stale_approval", "Current published head differs from saved contribution")
            }

            let remoteHead = Remote(
                run,
                amendment?.Text("previous") ?? run.Text("commit"),
                amendment?.Text("commit") ?? ""
            )

            RepositoryAccess.ValidateFork(
                run.Text("repo"),
                J.Parse(
                    J.Write(
                        map[string, Object?]{
                            "fork": run.Text("head_repo"),
                            "branch": run.Text("branch"),
                            "head": remoteHead
                        }
                    )
                ),
                J.Get(viewer, "id")
            )

            return J.Parse(J.Write(map[string, Object?]{"record": record, "state": value, "sha": state.Sha}))
        }

        private func CorrectionAuthority(
            run Data,
            amendment Data?,
            directory string,
            record JsonElement,
            state CoordinationState,
            value JsonElement,
            viewer JsonElement,
            original JsonElement
        ) JsonElement {
            if directory != "" {
                OriginalEvidence.Pinned(directory, run, record)
            }

            ContributionAuthority.Recheck(run)
            let intent = J.Get(amendment?.Element() ?? default(JsonElement), "publication")

            if intent.ValueKind == JsonValueKind.Object && state.Sha != amendment?.Text("expected") {
                let request = J.Get(intent, "request")
                let outcome = RequestData.Recorded(value, J.Get(viewer, "id"), request)
                Transition(run.Text("repo"), state, amendment?.Text("expected") ?? "")
                if J.Text(original, "request") != amendment?.Text("publication_uuid") || J.Text(
                    original,
                    "expected"
                ) != amendment?.Text("expected") || J.Get(original, "actor").ToString() != J.Get(viewer, "id")
                    .ToString() || !RequestData.Same(request, Submission.PublicationRequest(run, amendment)) ||
                    !RequestData.Same(J.Get(original, "metadata"), J.Get(request, "metadata")) ||
                    outcome.ValueKind != JsonValueKind.Object ||
                    !RequestData
                    .Same(outcome, J.Get(original, "outcome")) {
                    throw CliFailure(
                        "stale_approval",
                        "Stale coordination revision; only the exact saved publication transition can resume"
                    )
                }
            } else if original.ValueKind == JsonValueKind.Object {
                throw CliFailure("invalid_state", "Contribution already published")
            }

            UnpublishedRemote(
                run,
                amendment,
                intent.ValueKind == JsonValueKind.Undefined || J.Text(intent, "stage") == "prepared"
            )
            return J.Parse(J.Write(map[string, Object?]{"record": record, "state": value, "sha": state.Sha}))
        }

        private func Transition(repo string, state CoordinationState, expected string) {
            let revision = J.Text(state.Value(), "publication_revision")
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

            Commands.Git(checkout, "merge-base", "--is-ancestor", run.Text("base"), commit)
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
            let live = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
            live.Reservation(J.Get(run.Element(), "donor_id"))
            let state = live.Value()
            let savedCorrection = run.Text("amendment") != ""
            let correcting = run.Number("pr") == 0 && run.Text("state") != "published" &&
                (savedCorrection || J.Get(state, "contribution").ValueKind != JsonValueKind.Object)
            let continuing = args.Get("commit") == "" && args.Get("seconds") == ""
            if correcting && PrepareCorrection(args, directory, run, savedCorrection, continuing, state) {
                return
            }
            let coding = run.Text("source") == "external"
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

            if !correcting && change.Text("uuid") != "" {
                change = Data()
            }

            let saved = change.Text("commit") == commit

            if !saved && J.Get(change.Element(), "publication").ValueKind == JsonValueKind.Object {
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

            if change.Text("state") == "failed" || change.Text("state") == "verifying" {
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
            state JsonElement
        ) bool {
            Completed(directory, run)

            if args.Get("resume") != "" {
                throw CliFailure("invalid_state", "Resume requires a published PR")
            }

            let existing = savedCorrection ? Data.Load(
                Path.Combine(directory, "amendments", run.Text("amendment")),
                amendment: true
            ): nil

            if existing != nil && continuing && J.Get(existing.Element(), "publication")
                .ValueKind == JsonValueKind.Object {
                PublishSaved(directory, run, existing)
                return true
            }

            let record = J.Get(Authority(run, continuing ? existing: nil, directory: directory), "record")

            if J.Get(existing?.Element() ?? default(JsonElement), "publication").ValueKind != JsonValueKind.Object {
                Publication.Find(
                    run,
                    default(JsonElement),
                    newIntent: J.Get(state, "contribution").ValueKind != JsonValueKind.Object
                )
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

                Terminal.Message(
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

                    if value.Text("previous") != run.Text("commit") || J.Get(value.Element(), "request")
                        .ValueKind != JsonValueKind.Object {
                        continue
                    }

                    if args.Get("commit") != "" {
                        throw CliFailure(
                            "invalid_state",
                            "Multiple saved amendment requests. Select one with --commit and --time."
                        )
                    }
                    args.Values["--commit"] = value.Text("commit")
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
                correcting ? 4096: 8192
            )
            let summary = PublicSummary.FileSummary(args.Get("summary"), commit)
            let published = run.Text("commit")
            let authority = Authority(run, nil, args.Get("resume") == "true", directory: directory)
            let record = J.Get(authority, "record")
            let policy = Policy(J.Write(J.Get(record, "policy")))
            Tools(policy, tools)

            if seconds > J.Number(policy.Value, "max_seconds") {
                throw CliFailure("stale_approval", "Amendment verification budget exceeds owner policy")
            }

            let number = correcting ? 0: J.Number(
                J.Get(CoordinationState.Current(J.Get(authority, "state")), "outcome"),
                "pr"
            )
            let pull = correcting ? default(JsonElement): Pull(run, number, published, "")

            if !correcting {
                ReceiptVerification.Verify(run.Text("repo"), number, pull)
                Remote(run, published, "")
            }

            if coding {
                let baseline = GitHubPathEvidence.LocalBase(
                    source,
                    run.Text("repo"),
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

            let baseline = correcting ? run.Text("base"): GitHubPathEvidence.LocalBase(
                checkout,
                run.Text("repo"),
                J.Get(record, "approval"),
                commit,
                J.Text(record, "base")
            )
            let accepted = correcting ? "": Snapshot(checkout, run, commit, run.Text("commit"), record, baseline)
            let archive = OriginalEvidence.Capture(directory, run)

            let change = Data(
                map[string, Object?]{
                    "id": Guid.NewGuid().ToString("D"),
                    "commit": commit,
                    "seconds": seconds,
                    "tools": tools,
                    "previous": correcting ? "": run.Text("commit"),
                    "previous_remote": correcting ? run.Text("commit"): "",
                    "pr": number,
                    "expected": J.Text(authority, "sha"),
                    "attempt": J.Text(J.Get(J.Get(authority, "state"), "reservation"), "attempt"),
                    "original_evidence_sha256": archive,
                    "failure_stage": "candidate_validation",
                    "failure_reason": "candidate_invalid"
                }
            )

            change.Transition("validating")
            if correcting {
                change.Fields["version"] = 1
                change.Fields["uuid"] = change.Text("id")
            }

            if baseline != run.Text("base") {
                change.Fields["base"] = baseline
            }

            if summary.ValueKind != JsonValueKind.Undefined {
                change.Fields["public_summary"] = summary
            }

            for key in[]string{"tools", "summary"} {
                if args.Get(key) != "" {
                    change.Fields[key + "_argument"] = Path.GetFullPath(args.Get(key))
                    change.Fields[key + "_sha256"] = Convert.ToHexString(
                        SHA256.HashData(File.ReadAllBytes(args.Need(key)))
                    )
                }
            }

            change.Fields["previous_body"] = J.Text(pull, "body")

            VerifyCandidate(directory, run, change, checkout, commit, record, baseline, correcting, accepted)

            return change
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
                    change.Fields["tree"] = Commands.Git(checkout, "rev-parse", "HEAD^{tree}")
                }

                change.Fields[correcting ? "patch_sha256": "snapshot"] = Data.Hash(snapshot)
                File.WriteAllText(Path.Combine(location, "candidate.patch"), snapshot)

                File.WriteAllText(
                    Path.Combine(location, "conflict-evidence.txt"),
                    Commands.Git(checkout, "show", "--format=raw", "--cc", "--no-ext-diff", "--no-textconv", commit)
                )

                Save(directory, change)
                Verify(directory, run, change, record)
            } catch (error Exception) when ExecutionFailure.Handled(error) {
                change.Transition("failed")
                change.Fields["error"] = error.Message
                Save(directory, change)

                let failure = ExecutionFailure.From(
                    error,
                    change.Text("failure_reason") == "verification_failed" ? "verification_failed": "invalid_state"
                )

                throw CliFailure(
                    failure.Code,
                    PublicOutput.Enabled ? failure.Message: change.Text("failure_reason") + " (" + change.Text(
                        "failure_stage"
                    ) +
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
                            correcting ? 4096: 8192
                        )
                        default: PublicSummary.FileSummary(args.Get(key), commit)
                    }
                    let same = RequestData.Same(
                        J.Get(change.Element(), key == "summary" ? "public_summary": key),
                        input
                    )
                    let hash = change.Text(key + "_sha256")
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
            change.Text("commit")
        )

        private func Save(directory string, change Data) {
            change.Save(Location(directory, change))
            if change.Text("uuid") != "" {
                let run = Data.Load(directory)
                run.Fields["amendment"] = change.Text("commit")
                run.Save(directory)
            }
        }

        private func Exact(directory string, run Data, change Data, record JsonElement) string {
            let checkout = Path.Combine(directory, "checkout")
            let snapshot = Snapshot(
                checkout,
                run,
                change.Text("commit"),
                change.Text("previous"),
                record,
                change.Text("base") == "" ? run.Text("base"): change.Text("base")
            )
            let correcting = change.Text("uuid") != ""
            let patch = File.ReadAllText(Path.Combine(Location(directory, change), "candidate.patch"))
            if (correcting && Commands.Git(checkout, "rev-parse", "HEAD^{tree}") != change.Text("tree")) || Data.Hash(
                snapshot
            ) != change.Text(correcting ? "patch_sha256": "snapshot") || snapshot != patch {
                throw CliFailure("invalid_state", "Verified amendment candidate changed")
            }
            return snapshot
        }

        private func Verify(directory string, run Data, change Data, record JsonElement) {
            let location = Location(directory, change)
            let checkout = Path.Combine(directory, "checkout")
            let results = List[Object]()
            let timer = Stopwatch.StartNew()
            let seconds = change.Number("seconds")
            change.Fields["verification"] = results
            change.Transition("verifying")
            change.Fields["failure_stage"] = "owner_verification"
            change.Fields["failure_reason"] = "verification_failed"
            Save(directory, change)
            PublicOutput.FailureCode = "verification_failed"
            Terminal.Step("Verifying the exact amendment independently. No inference will run.")
            let budget = RuntimeBudget(timer, seconds)
            {
                using let workspace = VerificationWorkspace.Create(checkout, budget)
                for command in J.Items(J.Get(J.Get(record, "policy"), "verification")) {
                    let remaining = seconds - Convert.ToInt32(timer.Elapsed.TotalSeconds)
                    if remaining < 1 {
                        throw CliFailure("verification_failed", "Amendment verification budget exhausted")
                    }
                    Save(directory, change)
                    let result = Verification.Verify(
                        location,
                        results,
                        command,
                        checkout,
                        remaining,
                        budget: budget,
                        workspace: workspace
                    )
                    Save(directory, change)
                    if result.Code != 0 && change.Text("uuid") == "" {
                        throw CliFailure(
                            "verification_failed",
                            "Amendment owner verification failed; saved progress retained"
                        )
                    }
                }
                PublicOutput.FailureCode = "invalid_state"
                change.Fields["failure_stage"] = "changed_candidate"
                change.Fields["failure_reason"] = "candidate_changed"
                workspace.Unchanged(budget)
            }
            Exact(directory, run, change, record)
            change.Fields[change.Text("uuid") != "" ? "verification_seconds": "elapsed_seconds"] = Convert.ToInt32(
                timer.Elapsed.TotalSeconds
            )
            change.Fields["failure_stage"] = "owner_verification"
            change.Fields["failure_reason"] = "verification_failed"
            PublicOutput.FailureCode = "verification_failed"
            Verification.Results(change, record)
            change.Transition("verified")
            change.Fields.Remove("failure_stage")
            change.Fields.Remove("failure_reason")
            Save(directory, change)
        }

        internal func Remote(run Data, previous string, candidate string) string {
            let reference = GitHub.Api("repos/" + run.Text("head_repo") + "/git/ref/heads/" + run.Text("branch"))
            let head = J.Text(J.Get(reference, "object"), "sha")

            if head != previous && head != candidate {
                throw CliFailure("stale_approval", "Remote PR branch changed; saved amendment retained")
            }

            return head
        }

        internal func PublishSaved(directory string, run Data, amendment Data? = nil) {
            let change = amendment ?? Data.Load(
                Path.Combine(directory, "amendments", run.Text("amendment")),
                amendment: true
            )
            let location = Location(directory, change)
            try {
                OriginalEvidence.Amended(directory, run, change)
                let authority = Authority(run, change, directory: directory)
                let record = J.Get(authority, "record")
                let policy = Policy(J.Write(J.Get(record, "policy")))
                if change.Text("uuid") != "" {
                    Completed(Path.Combine(directory, "original-evidence"), OriginalEvidence.Load(directory, run))
                    RequestData.CorrectionTools(J.Get(change.Element(), "tools"), policy.Value)
                    if change.Text("state") != "verified" || run.Text("commit") != change.Text("commit") ||
                        !RequestData.Same(J.Get(run.Element(), "correction"), Provenance(change)) || !RequestData.Same(
                        J.Get(run.Element(), "verification"),
                        J.Get(change.Element(), "verification")
                    ) {
                        throw CliFailure("invalid_state", "Only the saved verified exact correction can be published")
                    }
                } else {
                    Tools(policy, J.Get(change.Element(), "tools"))
                }
                if change.Number("seconds") < 1 || change.Number("seconds") > J.Number(policy.Value, "max_seconds") {
                    throw CliFailure("stale_approval", "Amendment budget exceeds current owner policy")
                }
                Verification.Results(change, record)
                let snapshot = Exact(directory, run, change, record)
                if change.Text("uuid") != "" {
                    PublishCorrection(directory, run, change, record)
                } else {
                    Publish(directory, location, run, change, authority, snapshot)
                }
            } catch (error Exception) when ExecutionFailure.Handled(error) {
                change.Fields["error"] = error.Message
                change.Fields["failure_reason"] = error is CliFailure failure ? failure.Code: "publication_interrupted"
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
            let published = amendment.Text("previous")
            let pull = Pull(run, amendment.Number("pr"), published, amendment.Text("commit"))
            let remote = Remote(run, published, amendment.Text("commit"))

            if J.Text(J.Get(pull, "head"), "sha") != remote {
                throw CliFailure("stale_approval", "Remote branch and PR head disagree")
            }

            let receipt = PrBody.Receipt(J.Text(pull, "body"))
            let previousReceipt = PrBody.Receipt(amendment.Text("previous_body"))

            if amendment.Text("state") == "verified" {
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

            let previousOwned = PrBody.Owned(amendment.Text("previous_body"))
            let owned = PrBody.Owned(J.Text(pull, "body"))

            if owned != previousOwned && owned != PrBody.Owned(amendment.Text("body")) {
                throw CliFailure("stale_approval", "PR owned regions differ from saved previous or candidate state")
            }

            if remote == published {
                if RequestData.Canonical(receipt) != RequestData.Canonical(previousReceipt) || owned != previousOwned {
                    throw CliFailure(
                        "stale_approval",
                        "Invalid physical state: candidate receipt on the previous remote head"
                    )
                }

                Authority(run, amendment, directory: directory)
                Pull(run, amendment.Number("pr"), published, "")
                Remote(run, published, "")

                if Exact(directory, run, amendment, record) != snapshot {
                    throw CliFailure("invalid_state", "Amendment checkout changed before push")
                }

                Access(run, record)

                Publication.Push(checkout, run, amendment.Text("commit"))
            }

            Authority(run, amendment, directory: directory)

            Remote(run, amendment.Text("commit"), "")

            let latest = Pull(run, amendment.Number("pr"), amendment.Text("commit"), "")

            GitHubPathEvidence.Amendment(
                run.Text("repo"),
                record,
                J.Get(amendment.Element(), "request").GetProperty("metadata")
            )

            Authority(run, amendment, directory: directory)

            if J.Text(authority, "sha") != amendment.Text("expected") {
                ReceiptVerification.Verify(run.Text("repo"), amendment.Number("pr"))

                Complete(directory, location, run, amendment, latest)
                return
            }

            let request = J.Get(amendment.Element(), "request")
            let path = Path.Combine(location, "request.json")

            File.WriteAllText(path, J.Write(request) + "\n")

            if amendment.Text("state") != "requested" {
                Submission.Request(
                    Args([]string{"request", run.Text("repo") + "#" + run.Number("issue").ToString(), "--file", path})
                )

                Authority(run, amendment, directory: directory)

                amendment.Transition("requested")

                amendment.Save(location)
            }

            Terminal.Message(
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
            receipt JsonElement,
            previousReceipt JsonElement
        ) {
            if remote != published || J.Text(receipt, "head") != amendment.Text("previous") {
                throw CliFailure("stale_approval", "Remote changed before amendment publication intent")
            }

            if RequestData.Canonical(receipt) != RequestData.Canonical(previousReceipt) {
                throw CliFailure("stale_approval", "Previous receipt changed after amendment acceptance")
            }

            let intent = map[string, Object?]{
                "previous": amendment.Text("previous"),
                "head": amendment.Text("commit"),
                "pr": amendment.Number("pr"),
                "uuid": amendment.Text("id")
            }

            amendment.Fields["publication"] = intent

            let updatedReceipt = Receipt(receipt, amendment, amendment.Text("commit"), amendment.Text("expected"))

            let original = J.Get(J.Get(authority, "state"), "contribution")

            let metadata = PublicSummary.Attach(
                map[string, Object?]{
                    "fork": run.Text("head_repo"),
                    "branch": run.Text("branch"),
                    "previous": amendment.Text("previous"),
                    "head": amendment.Text("commit"),
                    "attempt": amendment.Text("attempt") == "" ? run.Text("attempt"): amendment.Text("attempt"),
                    "pr": amendment.Number("pr"),
                    "seconds": amendment.Number("seconds"),
                    "tools": J.Get(amendment.Element(), "tools"),
                    "verification": "donor-reported-pass"
                },
                J.Get(amendment.Element(), "public_summary")
            )

            amendment.Fields["body"] = PrBody.ReplaceBody(
                J.Text(pull, "body"),
                PrBody.PublicReport(J.Parse(J.Write(metadata)), J.Get(original, "metadata")),
                updatedReceipt
            )

            if amendment.Text("base") != "" {
                metadata["base"] = amendment.Text("base")
            }

            amendment.Fields["request"] = map[string, Object?]{
                "uuid": amendment.Text("id"),
                "expected": amendment.Text("expected"),
                "approval": run.Text("approval"),
                "action": "amend",
                "metadata": metadata
            }

            amendment.Transition("publishing")

            amendment.Save(location)

            File.WriteAllText(Path.Combine(location, "publication.json"), J.Write(amendment.Element()) + "\n")
        }

        internal func Completed(directory string, run Data) Dictionary[string, Object?] {
            let state = run.Text("state")
            if run.Number("version") != 2 || run.Text("source") != "tokate" || run.Number("pr") != 0 ||
                state == "published" {
                throw CliFailure(
                    "invalid_state",
                    "Correction requires unpublished managed work; external work uses external --run"
                )
            }

            let reason = run.Text("failure_reason")

            if (state != "failed" && state != "generated") ||
                reason == "inference_failed" ||
                reason == "inference_interrupted" ||
                run.Flag("output_truncated") || run.Text("error").StartsWith("Codex failed.") ||
                (run.Fields.ContainsKey("inference_exit_code") && run.Number("inference_exit_code") != 0) {
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
            run.Fields["commit"] = correction.Text("commit")
            run.Fields["verification"] = J.Get(correction.Element(), "verification")
            let summary = J.Get(correction.Element(), "public_summary")

            if summary.ValueKind == JsonValueKind.Undefined {
                run.Fields.Remove("public_summary")
            } else {
                run.Fields["public_summary"] = summary
            }

            run.Fields.Remove("summary_patch_sha256")
            run.Fields["correction"] = Provenance(correction)
            run.Fields["amendment"] = correction.Text("commit")
            run.Transition("generated")
            run.Fields.Remove("error")
            run.Fields.Remove("failure_reason")
            run.Fields.Remove("failure_stage")

            run.Save(directory)
        }

        internal func Provenance(correction Data) JsonElement -> J.Parse(
            J.Write(
                map[string, Object?]{
                    "uuid": correction.Text("uuid"),
                    "head": correction.Text("commit"),
                    "tree": correction.Text("tree"),
                    "patch_sha256": correction.Text("patch_sha256"),
                    "seconds": correction.Number("seconds"),
                    "tools": J.Get(correction.Element(), "tools"),
                    "verification": "tokate-observed-locally-exact-commit"
                }
            )
        )

        private func UnpublishedRemote(run Data, correction Data?, initial bool = false) string {
            let reference = GitHub.Api(
                "repos/" + RepositoryIdentity.Repo(run.Text("head_repo")) + "/git/ref/heads/" + run.Text("branch"),
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

            if head != run.Text("base") && head != run.Text("commit") &&
                head != (correction?.Text("previous_remote") ?? "") &&
                head != (correction?.Text("commit") ?? "") {
                throw CliFailure(
                    "invalid_state",
                    "interrupted_publication: remote branch changed; refusing to overwrite it"
                )
            }

            return head
        }

        private func Access(run Data, record JsonElement, current bool = false) {
            let approval = J.Get(record, "approval")
            let policy = current ? ApprovalBase.Check(run.Text("repo"), approval, true).Item1.Value: J.Get(
                record,
                "policy"
            )
            AccessState.Check(run.Text("repo"), run.Number("issue"), approval, J.Get(run.Element(), "donor_id"), policy)
        }

        private func PublishCorrection(directory string, run Data, change Data, record JsonElement) {
            var intent = J.Get(change.Element(), "publication")
            if intent.ValueKind == JsonValueKind.Undefined {
                let authority = Authority(run, change, directory: directory)
                change.Fields["expected"] = J.Text(authority, "sha")
                change.Fields["publication_uuid"] = Guid.NewGuid().ToString("D")
                run.Fields["publication_expected"] = change.Text("expected")
                run.Save(directory)
                let request = Submission.PublicationRequest(run, change)
                RequestData.Parse(J.Write(request))
                RequestData.Request(request)
                for file in[]string{"request.json", "publication.json"} {
                    RunStorage.ControlFile(directory, file)
                    let previous = Path.Combine(directory, file)
                    if File.Exists(previous) {
                        File.Move(previous, Path.Combine(Location(directory, change), "previous-" + file))
                    }
                }
                change.Fields["publication"] = map[string, Object?]{"stage": "prepared", "request": request}
                Save(directory, change)
                intent = J.Get(change.Element(), "publication")
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
                run.Text("repo"),
                run.Number("issue"),
                J.Get(intent, "request"),
                run.Text("id"),
                run.Text("donor")
            )
            Preview(Path.Combine(directory, "publication.json"), J.Write(receipt) + "\n")
            let unrecorded = J.Get(J.Get(authority, "state"), "contribution").ValueKind != JsonValueKind.Object
            let existing = Publication.Find(run, J.Parse(J.Write(receipt)), newIntent: unrecorded)
            if J.Text(authority, "sha") != change.Text("expected") {
                if existing.ValueKind == JsonValueKind.Undefined || remote != change.Text("commit") || J.Number(
                    J.Get(J.Get(J.Get(authority, "state"), "contribution"), "outcome"),
                    "pr"
                ) != J
                    .Number(existing, "number") {
                    throw CliFailure("stale_approval", "Saved coordination outcome lacks exact physical PR and branch")
                }
                SetStage(directory, change, "published")
                for key in[]string{"failure_stage", "failure_reason", "publication_error", "error"} {
                    change.Fields.Remove(key)
                }
                Save(directory, change)
                Publication.SavePr(directory, run, existing)
                return
            }
            if existing.ValueKind != JsonValueKind.Undefined && J.Text(J.Get(existing, "head"), "sha") != remote {
                throw CliFailure("stale_approval", "Physical PR and remote branch disagree")
            }
            if remote != change.Text("commit") {
                SetStage(directory, change, "push_pending")
                Access(run, record, true)
                Publication.Push(Path.Combine(directory, "checkout"), run, change.Text("commit"))
                if UnpublishedRemote(run, change) != change.Text("commit") {
                    throw CliFailure("command_failed", "Corrected remote commit missing after push")
                }
                Authority(run, change, directory: directory)
            }
            if stage == "request_pending" || stage == "requested" {
                if !Submission.Posted(
                    run.Text("repo"),
                    run.Number("issue"),
                    J.Get(run.Element(), "donor_id"),
                    J.Get(intent, "request")
                ) {
                    throw CliFailure(
                        "invalid_state",
                        "interrupted_publication: saved request has no unique physical comment; refusing blind retry"
                    )
                }
                SetStage(directory, change, "requested")
                Terminal.Message(
                    "Exact publication request is already posted; awaiting the coordinator. No write, checks or inference repeated."
                )
                return
            }
            Exact(directory, run, change, record)
            let latest = Authority(run, change, directory: directory)
            Access(run, record, true)
            let request = Publication.Prepare(run, record, J.Get(intent, "request"), newIntent: unrecorded)
            change.Fields["publication_pr"] = J.Number(J.Get(request, "metadata"), "pr")
            change.Fields["publication"] = map[string, Object?]{"stage": stage, "request": request}
            Save(directory, change)
            Preview(path, J.Write(request) + "\n")
            SetStage(directory, change, "request_pending")
            Submission.WriteRequest(
                run.Text("repo"),
                run.Number("issue"),
                J.Get(run.Element(), "donor_id"),
                request,
                CoordinationState.Unix(J.Get(J.Get(latest, "state"), "reservation"), "expires")
            )
            SetStage(directory, change, "requested")
            Terminal.Message("Exact correction publication request posted. The coordinator must adopt the donor PR.")
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
            let intent = Data.From(J.Get(correction.Element(), "publication"))
            intent.Fields["stage"] = stage
            correction.Fields["publication"] = intent.Fields
            Save(directory, correction)
        }

        internal func Receipt(previous JsonElement, amendment Data, head string, expected string) JsonElement {
            let fields = Data.From(previous).Fields
            fields["head"] = head
            fields["expected"] = expected
            fields["amendment"] = PublicRecord(amendment)
            fields.Remove("incomplete")
            return J.Parse(J.Write(fields))
        }

        internal func PublicRecord(amendment Data) Object {
            let fields = map[string, Object?]{
                "id": amendment.Text("id"),
                "previous": amendment.Text("previous"),
                "seconds": amendment.Number("seconds"),
                "tools": J.Get(amendment.Element(), "tools")
            }

            if amendment.Text("base") != "" {
                fields["base"] = amendment.Text("base")
            }

            return PublicSummary.Attach(fields, J.Get(amendment.Element(), "public_summary"))
        }

        internal func Complete(directory string, location string, run Data, amendment Data, pull JsonElement) {
            amendment.Transition("published")
            amendment.Fields.Remove("error")
            amendment.Fields.Remove("failure_reason")

            amendment.Save(location)

            let history = J.Items(J.Get(run.Element(), "amendments"))
            if !history.Exists(old -> J.Text(old, "id") == amendment.Text("id")) {
                history.Add(
                    J.Parse(
                        J.Write(
                            map[string, Object?]{
                                "id": amendment.Text("id"),
                                "previous": amendment.Text("previous"),
                                "head": amendment.Text("commit")
                            }
                        )
                    )
                )
            }

            run.Fields["amendments"] = history
            run.Fields["commit"] = amendment.Text("commit")

            if amendment.Text("attempt") != "" {
                run.Fields["publication_attempt"] = amendment.Text("attempt")
            }

            run.Fields.Remove("incomplete")

            Publication.SavePr(directory, run, pull)

            Terminal.Message(
                "Verified amendment published; original evidence: " + Path.Combine(directory, "original-evidence")
            )
        }
    }
}
