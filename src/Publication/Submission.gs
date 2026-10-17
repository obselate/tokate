package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Submission {
    shared {
        internal func Commit(directory string) {
            try {
                using let lease = RunStorage.Lease(directory)
                let run = Data.Load(directory)
                CommitPrepared(directory, run)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
            }
        }

        private func CommitPrepared(directory string, run Data, incomplete bool = false) {
            let record = ContributionAuthority.Recheck(run)

            if run.Text("source") != "tokate" || run.Text("state") != (
                incomplete ? "incomplete_generated": "generated"
            ) {
                throw CliFailure("invalid_state", "Expected successfully verified Tokate execution")
            }

            let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))
            let head = Commands.Git(checkout, "rev-parse", "HEAD")
            let start = ContributionHandoff.StartHead(run)
            let recovered = incomplete && head != start && Commands.Git(
                checkout,
                "show",
                "-s",
                "--format=%P",
                "HEAD"
            ) == start

            if head != start && !recovered {
                throw CliFailure("invalid_state", "Verified base changed")
            }

            Commands.Git(checkout, "diff", "--exit-code")
            ProtectedPaths.Local(checkout, J.Get(record, "policy"), J.Get(record, "approval"), run.Text("base"))

            let patch = Commands.GitRaw(checkout, []string{"diff", "--cached", "--binary", run.Text("base")})

            if patch != File.ReadAllText(Path.Combine(directory, "changes.patch")) {
                throw CliFailure("invalid_state", "Verified patch changed")
            }

            PublicSummary.Bind(run, patch)

            if incomplete && J.Get(run.Element(), "public_summary").ValueKind == JsonValueKind.Undefined {
                throw CliFailure("invalid_state", "Incomplete draft summary no longer matches the saved patch")
            }

            if !recovered {
                Commands.Git(
                    checkout,
                    "-c",
                    "user.name=" + run.Text("donor"),
                    "-c",
                    "user.email=" + RepositoryIdentity.Email(J.Get(run.Element(), "donor_id"), run.Text("donor")),
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    (incomplete ? "Incomplete: ": "") +
                        (
                        run.Flag("gratis") && run.Text("gratis_title") != "" ?
                        run.Text("gratis_title"): J.Text(J.Get(record, "issue"), "title")
                    )
                )
            }

            run.Fields["commit"] = Commands.Git(checkout, "rev-parse", "HEAD")

            ProtectedPaths.Local(
                checkout,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                run.Text("base"),
                run.Text("commit")
            )

            let summary = PublicSummary.ForHead(run, run.Text("commit"))

            if summary.ValueKind != JsonValueKind.Undefined {
                run.Fields["public_summary"] = summary
            }

            run.Fields["verification_provenance"] = run.Flag(
                "gratis"
            ) ? "No repository check ran": incomplete ? "not passed; incomplete draft": "tokate-observed locally"
            run.Fields[
                "tool_provenance"
            ] = "Tokate-observed harness invocation and requested model/effort; tool-reported usage, not identity attestation"

            run.Save(directory)

            Output.Sink.Message(
                (incomplete ? "Incomplete commit": "Verified commit") + " saved. Use " + Output.Sink.Command(
                    []string{"tokate", "submit", "--run", directory}
                )
            )
        }

        private func Partial(directory string, run Data) {
            if RequestMetadata.Incomplete(run.Element()) {
                if run.Text("commit") == "" && run.Text("state") == "incomplete_generated" {
                    CommitPrepared(directory, run, true)
                }

                return
            }

            var started = false
            for name in Harness.Table.Keys {
                started = started || run.Text(name + "_version") != ""
            }
            if run.Text("source") != "tokate" ||
                (run.Text("state") != "failed" && run.Text("state") != "running") ||
                !started ||
                run.Text("commit") != "" || run.Number("pr") != 0 {
                throw CliFailure("invalid_state", "Incomplete publication requires stopped, unpublished managed work")
            }

            let record = ContributionAuthority.Recheck(run)
            let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))

            PublicSummary.Capture(directory, checkout, run)

            if J.Get(run.Element(), "public_summary").ValueKind == JsonValueKind.Undefined {
                throw CliFailure(
                    "invalid_state",
                    "Write a short tokate-public-summary.json in the saved checkout before publishing incomplete work"
                )
            }

            let budget = RuntimeBudget(Stopwatch.StartNew(), Math.Min(60, run.Number("seconds")))
            let patch = Contribution.Snapshot(checkout, run, budget)

            ProtectedPaths.Local(
                checkout,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                run.Text("base"),
                budget: budget
            )

            PublicSummary.Bind(run, patch)

            File.WriteAllText(Path.Combine(directory, "changes.patch"), patch)

            run.Fields["partial_source_state"] = run.Text("state")
            run.Fields["incomplete"] = true
            run.Transition("incomplete_generated")

            run.Save(directory)

            CommitPrepared(directory, run, true)
        }

        internal func Posted(repo string, issue int32, actor JsonElement, request JsonElement) bool {
            return Comment(repo, issue, actor, request).ValueKind != JsonValueKind.Undefined
        }

        internal func Comment(repo string, issue int32, actor JsonElement, request JsonElement) JsonElement {
            RepositoryIdentity.PositiveId(actor)
            let declaration = CoordinatorRequest.Parse(request)

            var count int32
            var found JsonElement

            for page in 1 ... 21 {
                let response = GitHub.Api(
                    "repos/" + repo + "/issues/" + issue.ToString() + "/comments?per_page=100&page=" + page.ToString()
                )

                if response.ValueKind != JsonValueKind.Array {
                    throw CliFailure("invalid_state", "Cannot inspect complete request comment evidence")
                }

                for row in response.EnumerateArray() {
                    if J.Get(J.Get(row, "user"), "id").ToString() != actor.ToString() {
                        continue
                    }

                    let body = J.Text(row, "body")

                    if !body.StartsWith("/tokate ", StringComparison.Ordinal) {
                        continue
                    }

                    var candidate JsonElement
                    var candidateId string

                    try {
                        candidate = RequestMetadata.CommentData(body)
                        candidateId = J.Text(candidate, "uuid")
                    } catch (error CliFailure) {
                        continue
                    }

                    if candidateId != declaration.Uuid {
                        continue
                    }

                    let id = RepositoryIdentity.PositiveId(J.Get(row, "id"))
                    let canonical = GitHub.Api("repos/" + repo + "/issues/comments/" + id.ToString())
                    let failure = "Request UUID has changed actor, contents, repository or issue evidence"

                    if RepositoryIdentity.PositiveId(J.Get(canonical, "id")) != id {
                        throw CliFailure("stale_approval", failure)
                    }

                    let author = J.Get(J.Get(canonical, "user"), "id")

                    if RepositoryIdentity.PositiveId(author) != RepositoryIdentity.PositiveId(actor) {
                        throw CliFailure("stale_approval", failure)
                    }

                    if !RepositoryIdentity.IsIssueUrl(J.Text(canonical, "issue_url"), repo, issue) {
                        throw CliFailure("stale_approval", failure)
                    }

                    if J.Text(canonical, "body") != body {
                        throw CliFailure("stale_approval", failure)
                    }

                    if RequestData.Canonical(candidate) != RequestData.Canonical(request) {
                        throw CliFailure("stale_approval", failure)
                    }

                    count++
                    found = canonical
                }

                if response.GetArrayLength() < 100 {
                    if count > 1 {
                        throw CliFailure("invalid_state", "Ambiguous duplicate request comments")
                    }

                    return found
                }
            }

            throw CliFailure("invalid_state", "Request comment inspection exceeded its bounded history; no write made")
        }

        private let WorkflowGuidance Dictionary[string, Dictionary[string, Object?]?] = Dictionary[
            string,
            Dictionary[string, Object?]?
        ]()

        internal const StartupFailure string = "GitHub could not start the Tokate workflow. The usual cause is that the repository's Actions settings do not allow obselate/tokate/.github/workflows/tokate-shared.yml at the pinned commit."

        internal func WorkflowRuns(repo string, query string, missing bool = false) JsonElement -> GitHub.Api(
            "repos/" + repo + "/actions/workflows/tokate-coordinator.yml/runs?" + query,
            missing: missing
        )

        internal func ResetWorkflow() -> WorkflowGuidance.Clear()

        internal func PendingWorkflow(directory string, run Data) Dictionary[string, Object?]? {
            let claim = run.Text("state") == "claim_pending"
            let path = Path.Combine(directory, "request.json")
            if run.Number("pr") != 0 || (!claim && (run.Text("publication_uuid") == "" || !File.Exists(path))) {
                return nil
            }
            let request = claim ? J.Get(run.Element(), "claim_request"): RequestData.FileData(path, 8192)
            let key = run.Text("repo") + ":" + CoordinatorRequest.Parse(request).Uuid
            var guidance Dictionary[string, Object?]?
            if WorkflowGuidance.TryGetValue(key, out guidance) {
                return guidance
            }
            WorkflowGuidance[key] = nil
            try {
                let repo = "repos/" + run.Text("repo")
                let comment = Comment(run.Text("repo"), run.Number("issue"), J.Get(run.Element(), "donor_id"), request)
                let created = J.Text(comment, "created_at")
                if created == "" {
                    return nil
                }
                let runs = WorkflowRuns(
                    run.Text("repo"),
                    "event=issue_comment&actor=" + Uri.EscapeDataString(J.Text(J.Get(comment, "user"), "login")) +
                        "&created=" +
                        Uri.EscapeDataString(">=" + created) + "&per_page=10"
                )
                var earliest JsonElement
                var first = ""
                for candidate in J.Items(J.Get(runs, "workflow_runs")) {
                    let time = J.Text(candidate, "created_at")
                    if String.CompareOrdinal(time, created) >= 0 &&
                        (first == "" || String.CompareOrdinal(time, first) < 0) {
                        earliest = candidate
                        first = time
                    }
                }
                var message = ""
                let conclusion = J.Text(earliest, "conclusion")
                let failed = conclusion == "failure" || conclusion == "startup_failure"
                if conclusion == "startup_failure" {
                    message = StartupFailure
                } else if conclusion == "failure" {
                    message = "Tokate workflow failed."
                    let checks = GitHub.Api(
                        repo + "/check-suites/" + J.Get(earliest, "check_suite_id").ToString() +
                            "/check-runs?per_page=100"
                    )
                    for check in J.Items(J.Get(checks, "check_runs")) {
                        let annotations = GitHub.Api(
                            repo + "/check-runs/" + J.Get(check, "id").ToString() + "/annotations?per_page=100"
                        )
                        for annotation in J.Items(annotations) {
                            if J.Text(annotation, "annotation_level") == "failure" {
                                let text = J.Text(annotation, "message")
                                message += " " + text.Substring(0, Math.Min(text.Length, 1024))
                                break
                            }
                        }
                        if message != "Tokate workflow failed." {
                            break
                        }
                    }
                } else if J.Text(earliest, "status") == "queued" || J.Text(earliest, "status") == "in_progress" {
                    message = "Tokate coordinator is still running."
                }
                if message != "" {
                    guidance = map[string, Object?]{
                        "role": failed ? "owner": "wait",
                        "action": message + " " + J.Text(earliest, "html_url") +
                            (failed ? " " + ApiTransport.MutationRecovery: ""),
                        "command": []string{}
                    }
                    WorkflowGuidance[key] = guidance
                }
                return guidance
            } catch (error Exception) when error is CliFailure || error is ApiDeadlineException {
                return nil
            }
        }

        internal func FailedWorkflow(directory string, run Data) {
            if let guidance = PendingWorkflow(directory, run) {
                if guidance["role"]?.ToString() == "owner" {
                    throw CliFailure("command_failed", guidance["action"]?.ToString() ?? "")
                }
            }
        }

        internal func Request(args Args) {
            try {
                let path = Path.GetFullPath(args.Need("file"))
                let value = RequestData.FileData(path, 8192)

                Request(args.Need("repo"), args.Number("issue"), value, path + ".posting.json")
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        internal func Request(
            requestRepo string,
            issue int32,
            value JsonElement,
            journal string,
            expectedActor JsonElement? = nil
        ) {
            let declaration = RequestMetadata.Request(value)

            let info = GitHub.Api("repos/" + RepositoryIdentity.Repo(requestRepo))
            let repo = RepositoryIdentity.Repo(J.Text(info, "full_name"))

            if !String.Equals(repo, requestRepo, StringComparison.OrdinalIgnoreCase) {
                throw CliFailure("stale_approval", "Canonical request repository differs from command")
            }

            RepositoryIdentity.PositiveId(J.Get(info, "id"))

            let viewer = GitHub.Api("user")
            let actor = J.Get(viewer, "id")

            RepositoryIdentity.PositiveId(actor)

            if let expected = expectedActor {
                if RepositoryIdentity.PositiveId(expected) != RepositoryIdentity.PositiveId(actor) {
                    throw CliFailure(
                        "authentication_required",
                        "Active GitHub account differs from the saved pending donor; no request posted"
                    )
                }
            }

            let binding = RequestMetadata.Binding(actor, value)

            if FileInfo(journal).LinkTarget != nil {
                throw CliFailure("invalid_state", "Request posting journal must not be a symbolic link")
            }

            if File.Exists(journal) {
                let saved = RequestData.FileData(journal, 16384)
                let failure = "Saved request UUID binding changed; use a new file and UUID for new work"

                if !RepositoryIdentity.SameRepo(J.Text(saved, "repo"), repo) || J.Number(saved, "issue") != issue {
                    throw CliFailure("stale_approval", failure)
                }

                let savedActor = J.Get(saved, "actor").ToString()

                if savedActor != actor.ToString() || J.Text(saved, "binding") != binding {
                    throw CliFailure("stale_approval", failure)
                }

                if RequestData.Canonical(J.Get(saved, "request")) != RequestData.Canonical(value) {
                    throw CliFailure("stale_approval", failure)
                }
            }

            let state = CoordinationState.Load(repo, issue)

            if declaration.Action != "release" {
                state.Check(repo, issue, RepositoryIdentity.Login(J.Text(viewer, "login")), actor)
            }

            let outcome = RequestMetadata.Recorded(state, actor, value)

            if outcome != nil {
                Output.Sink.RequestOutcome(outcome.Value())
                return
            }

            if Posted(repo, issue, actor, value) {
                Output.Sink.Message("Exact request already posted; awaiting coordinator outcome")
                return
            }

            if File.Exists(journal) {
                throw CliFailure(
                    "invalid_state",
                    "interrupted_publication: saved request has no unique physical comment; refusing blind retry"
                )
            }

            if state.Sha != declaration.Expected || state.ApprovalId != declaration.Approval {
                throw CliFailure("stale_approval", "Stale state or approval; no request posted")
            }

            if declaration.Action != "release" {
                state.Check(repo, issue, RepositoryIdentity.Login(J.Text(viewer, "login")), actor)
            }

            var expires int64

            if declaration.Action != "claim" {
                if LeaseLifecycle.Transition(declaration.Action) {
                    LeaseLifecycle.Owner(state, actor)
                } else {
                    state.Reservation(actor)
                    LeaseLifecycle.Fence(
                        state,
                        declaration.Action == "publish" ?
                        PublicationRequestMetadata.Parse(declaration.Metadata).Attempt:
                        AmendmentRequestMetadata.Parse(declaration.Metadata).Attempt
                    )
                }

                expires = state.Lease?.Expires ?? 0
            }

            WritePostingJournal(journal, repo, issue, actor, binding, value)

            WriteRequest(repo, issue, actor, value, expires)

            Output.Sink.Message("Request posted; coordinator outcome is recorded in the issue state ref")
        }

        internal func WriteRequest(repo string, issue int32, actor JsonElement, request JsonElement, expires int64) {
            try {
                let posted = GitHub.Api(
                    "repos/" + repo + "/issues/" + issue.ToString() + "/comments",
                    map[string, Object?]{"body": RequestMetadata.Comment(request)},
                    expires: expires
                )

                let failure = "Comment write response lacks exact request evidence"

                if !RepositoryIdentity.IsIssueUrl(J.Text(posted, "issue_url"), repo, issue) {
                    throw CliFailure("invalid_state", failure)
                }

                let author = J.Get(J.Get(posted, "user"), "id")

                if RepositoryIdentity.PositiveId(author) != RepositoryIdentity.PositiveId(actor) || J.Text(
                    posted,
                    "body"
                ) != RequestMetadata.Comment(request) {
                    throw CliFailure("invalid_state", failure)
                }

                RepositoryIdentity.PositiveId(J.Get(posted, "id"))
            } catch (error Exception) when error is CliFailure || error.GetType() == typeof(Exception) {
                let latest = CoordinationState.Load(repo, issue)

                if RequestMetadata.Recorded(latest, actor, request) == nil && !Posted(repo, issue, actor, request) {
                    let code = error is CliFailure failure && failure.Code != "invalid_state" ? failure.Code:
                    "command_failed"
                    throw CliFailure(
                        code,
                        "Uncertain request write; no unique canonical evidence. No POST retry made. " + error.Message,
                        action: error is CliFailure actionable ? actionable.Action: []string{},
                        summary: CliFailure.Message(code),
                        attemptInvalidated: error is CliFailure invalidated && invalidated.AttemptInvalidated,
                        httpStatus: error is CliFailure transport ? transport.HttpStatus: 0
                    )
                }
            }
        }

        internal func PublicationRequest(run Data, correction Data? = nil) JsonElement {
            let value = run.Element()
            var tools Object = J.Get(value, "tools")

            if run.Text("source") == "tokate" && run.Flag("turn_completed") {
                let tool = J.Select(J.Items(J.Get(value, "tools"))[0], "harness,provider,model,effort")
                let usage = map[string, Object?]{}

                for key in[]string{"input_tokens", "cached_input_tokens", "output_tokens"} {
                    let item = J.Get(J.Get(value, "usage"), key)
                    var count int64

                    if item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out count) && count >= 0 {
                        usage[key] = count
                    }
                }

                tool["usage"] = usage
                tool["coding_seconds"] = run.Number("execution_seconds")
                tools = []Object{tool}
            }

            let metadata = map[string, Object?]{
                "fork": run.Text("head_repo"),
                "branch": run.Text("branch"),
                "head": correction?.Text("commit") ?? run.Text("commit"),
                "attempt": run.Text("attempt"),
                "source": run.Text("source"),
                "tools": tools,
                "verification": RequestMetadata.Incomplete(run.Element()) ? "not-passed": "donor-reported-pass"
            }
            let pr = correction?.Number("publication_pr") ?? run.Number("publication_pr")
            if pr > 0 {
                metadata["pr"] = pr
            }

            ContributionReceipt.Models(metadata, run.Element())

            if RequestMetadata.Incomplete(run.Element()) {
                metadata["incomplete"] = true
            }

            if ContributionHandoff.Has(run) {
                metadata["handoff"] = J.Get(run.Element(), "handoff")
            }

            if AttemptContinuation.Has(run) {
                AttemptContinuation.Keep(metadata, PublicationRequestMetadata.Parse(AttemptContinuation.Metadata(run)))
            }

            if correction != nil {
                metadata["correction"] = Amendment.Provenance(correction)
            }

            var summary = PublicSummary.ForHead(run, run.Text("commit"))

            if let current = correction {
                summary = PublicSummary.ForHead(current, current.Text("commit"))
            }

            let request = CoordinatorRequest(
                correction?.Text("publication_uuid") ?? run.Text("publication_uuid"),
                run.Text("publication_expected") == "" ? run.Text("state_sha"): run.Text("publication_expected"),
                run.Text("approval"),
                "publish",
                J.Parse(J.Write(PublicSummary.Attach(metadata, summary)))
            )

            return J.Parse(request.ToJson())
        }

        internal func Submit(args Args, directory string, run Data) {
            RetrySummary(args, directory, run)

            if args.Get("incomplete") == "true" {
                Partial(directory, run)
            }

            if run.Text("amendment") != "" {
                Amendment.PublishSaved(directory, run)
                return
            }

            let path = Path.Combine(directory, "request.json")

            if RestorePublication(directory, run, path) {
                return
            }

            let record = ContributionAuthority.Recheck(run)

            if run.Text("state") != (RequestMetadata.Incomplete(run.Element()) ? "incomplete_generated": "generated") ||
                run.Text("commit") == "" {
                throw CliFailure("invalid_state", "Only an independently verified exact commit can be submitted")
            }

            if !RequestMetadata.Incomplete(run.Element()) {
                Verification.Results(run, Policy.Parse(J.Get(record, "policy")).Verification)
            }

            let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))

            if Commands.Git(checkout, "rev-parse", "HEAD") != run.Text("commit") || Commands.Git(
                checkout,
                "status",
                "--porcelain"
            ) != "" {
                throw CliFailure("invalid_state", "Verified checkout changed")
            }

            Commands.Git(checkout, "merge-base", "--is-ancestor", run.Text("base"), run.Text("commit"))
            Commands.Git(checkout, "diff", "--check", run.Text("base"), run.Text("commit"))

            ProtectedPaths.Local(
                checkout,
                J.Get(record, "policy"),
                J.Get(record, "approval"),
                run.Text("base"),
                run.Text("commit")
            )

            if run.Text("source") == "tokate" {
                File.WriteAllText(Path.Combine(directory, "publication.json"), "{}\n")

                AccessState.Check(
                    run.Text("repo"),
                    run.Number("issue"),
                    J.Get(record, "approval"),
                    J.Get(run.Element(), "donor_id"),
                    J.Get(record, "policy")
                )

                Publication.Push(checkout, run, run.Text("commit"))

                ContributionAuthority.Recheck(run)
            }

            if run.Text("publication_uuid") == "" {
                let live = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
                live.Reservation(J.Get(run.Element(), "donor_id"))
                LeaseLifecycle.Fence(live, run.Text("attempt"))

                run.Fields["publication_expected"] = live.Sha
                run.Fields["publication_uuid"] = Guid.NewGuid().ToString("D")

                run.Save(directory)
            }

            let request = Publication.Prepare(run, record, PublicationRequest(run))
            let declaration = CoordinatorRequest.Parse(request)
            run.Fields["publication_pr"] = PublicationRequestMetadata.Parse(declaration.Metadata).Pr
            run.Save(directory)

            File.WriteAllText(path, declaration.ToJson() + "\n")

            Request(Args([]string{"request", run.Text("repo") + "#" + run.Number("issue").ToString(), "--file", path}))
        }

        private func WritePostingJournal(
            journal string,
            repo string,
            issue int32,
            actor JsonElement,
            binding string,
            value JsonElement
        ) {
            try {
                using let file = FileStream(
                    journal,
                    FileStreamOptions{
                        Mode: FileMode.CreateNew,
                        Access: FileAccess.Write,
                        Share: FileShare.None,
                        UnixCreateMode: UnixFileMode.UserRead | UnixFileMode.UserWrite
                    }
                )
                using let writer = StreamWriter(file)

                writer.WriteLine(
                    J.Write(
                        map[string, Object?]{
                            "repo": repo,
                            "issue": issue,
                            "actor": actor,
                            "binding": binding,
                            "request": value
                        }
                    )
                )
                writer.Flush()
                file.Flush(true)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
            }
        }

        private func RetrySummary(args Args, directory string, run Data) {
            if run.Text("source") == "tokate" && run.Text("state") == "failed" && run.Text(
                "failure_reason"
            ) == "public_summary_invalid" &&
                run.Flag("turn_completed") && run.Text("commit") == "" && run.Number("pr") == 0 && args.Get(
                "incomplete"
            ) != "true" {
                let record = ContributionAuthority.Recheck(run)
                let timer = Stopwatch.StartNew()
                let elapsed = run.Number("elapsed_seconds")

                try {
                    Contribution.Finish(
                        directory,
                        run,
                        record,
                        J.Select(J.Get(run.Element(), "usage"), "input_tokens,cached_input_tokens,output_tokens"),
                        timer,
                        run.Number("seconds"),
                        run.Number("verification_reserve"),
                        elapsed
                    )
                } catch (error Exception) when ExecutionFailure.Handled(error) {
                    run.Transition("failed")
                    run.Fields["error"] = error.Message
                    run.Fields["elapsed_seconds"] = elapsed + Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))

                    run.Save(directory)

                    if error is CliFailure {
                        throw error
                    }

                    throw CliFailure("command_failed", error.Message, summary: CliFailure.Message("command_failed"))
                }

                CommitPrepared(directory, run)
            }
        }

        private func RestorePublication(directory string, run Data, path string) bool {
            if run.Text("publication_uuid") != "" && File.Exists(path) {
                let saved = RequestData.FileData(path, 8192)
                let expected = PublicationRequest(run)

                if RequestData.Canonical(saved) != RequestData.Canonical(expected) {
                    throw CliFailure("stale_approval", "Saved publication UUID binding changed")
                }

                let viewer = GitHub.Api("user")

                if J.Get(viewer, "id").ToString() != J.Get(run.Element(), "donor_id").ToString() {
                    throw CliFailure("stale_approval", "Saved publication belongs to another authenticated actor")
                }

                let state = CoordinationState.Load(RepositoryIdentity.Repo(run.Text("repo")), run.Number("issue"))
                let outcome = RequestMetadata.Recorded(state, J.Get(viewer, "id"), saved)

                if outcome != nil {
                    if state.ApprovalId != run.Text("approval") || (state.Lease?.Reservation ?? "") != run.Text("id") {
                        throw CliFailure("stale_approval", "Saved publication has stale coordination authority")
                    }

                    state.Reservation(J.Get(viewer, "id"))
                    state.Check(
                        RepositoryIdentity.Repo(run.Text("repo")),
                        run.Number("issue"),
                        run.Text("donor"),
                        J.Get(viewer, "id")
                    )

                    let repo = RepositoryIdentity.Repo(run.Text("repo"))
                    let number = outcome.Pr
                    let pull = GitHub.Api("repos/" + repo + "/pulls/" + number.ToString())
                    let published = ReceiptVerification.Verify(repo, number, pull)

                    if published.Text("commit") != run.Text("commit") || published.Text("approval") != run.Text(
                        "approval"
                    ) ||
                        published.Text("reservation") != run.Text("id") {
                        throw CliFailure("stale_approval", "Published receipt differs from this saved contribution")
                    }

                    if run.Text("state") != "published" || run.Number("pr") != number || run.Text("pr_url") != J.Text(
                        pull,
                        "html_url"
                    ) {
                        Publication.SavePr(directory, run, pull)
                    }

                    return true
                }
            }
            return false
        }
    }
}
