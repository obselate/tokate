package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Submission {
    shared {
        internal func Commit(directory string) {
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
            CommitPrepared(directory, run)
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
                    "user.email=tokate@users.noreply.github.com",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-m",
                    (incomplete ? "Incomplete: ": "") + J.Text(J.Get(record, "issue"), "title")
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
            run.Fields[
                "verification_provenance"
            ] = incomplete ? "not passed; incomplete draft": "tokate-observed locally"
            run.Fields[
                "tool_provenance"
            ] = "Tokate-observed harness invocation and requested model/effort; tool-reported usage, not identity attestation"
            run.Save(directory)
            Terminal.Message(
                (incomplete ? "Incomplete commit": "Verified commit") + " saved. Use submit --run " + directory
            )
        }

        private func Partial(directory string, run Data) {
            if RequestData.Incomplete(run.Element()) {
                if run.Text("commit") == "" && run.Text("state") == "incomplete_generated" {
                    CommitPrepared(directory, run, true)
                }
                return
            }
            if run.Text("source") != "tokate" ||
                (run.Text("state") != "failed" && run.Text("state") != "running") ||
                (
                run.Text("codex_version") == "" && run.Text("pi_version") == "" && run.Text("claude_version") == "" &&
                    run.Text("omp_version") == ""
            ) ||
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
            run.Fields["state"] = "incomplete_generated"
            run.Save(directory)
            CommitPrepared(directory, run, true)
        }

        internal func Posted(repo string, issue int32, actor JsonElement, request JsonElement) bool {
            RepositoryIdentity.PositiveId(actor)
            var count int32
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
                    try {
                        candidate = RequestData.CommentData(body)
                    } catch {
                        continue
                    }
                    if J.Text(candidate, "uuid") != J.Text(request, "uuid") {
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
                }
                if response.GetArrayLength() < 100 {
                    if count > 1 {
                        throw CliFailure("invalid_state", "Ambiguous duplicate request comments")
                    }
                    return count == 1
                }
            }
            throw CliFailure("invalid_state", "Request comment inspection exceeded its bounded history; no write made")
        }

        internal func Request(args Args) {
            let path = Path.GetFullPath(args.Need("file"))
            let value = RequestData.FileData(path, 8192)
            Request(args.Need("repo"), args.Number("issue"), value, path + ".posting.json")
        }

        internal func Request(
            requestRepo string,
            issue int32,
            value JsonElement,
            journal string,
            expectedActor JsonElement? = nil
        ) {
            RequestData.Request(value)
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
            let binding = RequestData.Binding(actor, value)
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
            if J.Text(value, "action") != "release" {
                state.Check(repo, issue, RepositoryIdentity.Login(J.Text(viewer, "login")), actor)
            }
            let outcome = RequestData.Recorded(state.Value(), actor, value)
            if outcome.ValueKind != JsonValueKind.Undefined {
                Terminal.Json(outcome, "Recorded request outcome; no comment posted")
                return
            }
            if Posted(repo, issue, actor, value) {
                Terminal.Message("Exact request already posted; awaiting coordinator outcome")
                return
            }
            if File.Exists(journal) {
                throw CliFailure(
                    "invalid_state",
                    "interrupted_publication: saved request has no unique physical comment; refusing blind retry"
                )
            }
            if state.Sha != J.Text(value, "expected") || J.Text(state.Value(), "approval_id") != J.Text(
                value,
                "approval"
            ) {
                throw CliFailure("stale_approval", "Stale state or approval; no request posted")
            }
            if J.Text(value, "action") != "release" {
                state.Check(repo, issue, RepositoryIdentity.Login(J.Text(viewer, "login")), actor)
            }
            var expires int64
            if J.Text(value, "action") != "claim" {
                if LeaseLifecycle.Transition(J.Text(value, "action")) {
                    LeaseLifecycle.Owner(state, actor)
                } else {
                    state.Reservation(actor)
                    LeaseLifecycle.Fence(state, J.Text(J.Get(value, "metadata"), "attempt"))
                }
                expires = CoordinationState.Unix(J.Get(state.Value(), "reservation"), "expires")
            }
            {
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
            }
            WriteRequest(repo, issue, actor, value, expires)
            Terminal.Message("Request posted; coordinator outcome is recorded in the issue state ref")
        }

        internal func WriteRequest(repo string, issue int32, actor JsonElement, request JsonElement, expires int64) {
            try {
                let posted = GitHub.Api(
                    "repos/" + repo + "/issues/" + issue.ToString() + "/comments",
                    map[string, Object?]{"body": RequestData.Comment(request)},
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
                ) != RequestData.Comment(request) {
                    throw CliFailure("invalid_state", failure)
                }
                RepositoryIdentity.PositiveId(J.Get(posted, "id"))
            } catch (error Exception) {
                let latest = CoordinationState.Load(repo, issue)
                if RequestData.Recorded(latest.Value(), actor, request)
                    .ValueKind == JsonValueKind.Undefined &&
                    !Posted(repo, issue, actor, request) {
                    throw Exception(
                        "Uncertain request write; no unique canonical evidence. No POST retry made. " + error.Message
                    )
                }
            }
        }

        internal func PublicationRequest(run Data, correction Data? = nil) JsonElement {
            let metadata = map[string, Object?]{
                "fork": run.Text("head_repo"),
                "branch": run.Text("branch"),
                "head": correction?.Text("commit") ?? run.Text("commit"),
                "attempt": run.Text("attempt"),
                "source": run.Text("source"),
                "tools": J.Get(run.Element(), "tools"),
                "verification": RequestData.Incomplete(run.Element()) ? "not-passed": "donor-reported-pass"
            }
            if RequestData.Incomplete(run.Element()) {
                metadata["incomplete"] = true
            }
            if ContributionHandoff.Has(run) {
                metadata["handoff"] = J.Get(run.Element(), "handoff")
            }
            if AttemptContinuation.Has(run) {
                AttemptContinuation.Keep(metadata, AttemptContinuation.Metadata(run))
            }
            if correction != nil {
                metadata["correction"] = Correction.Provenance(correction)
            }
            var summary = PublicSummary.ForHead(run, run.Text("commit"))
            if let current = correction {
                summary = PublicSummary.ForHead(current, current.Text("commit"))
            }
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "uuid": correction?.Text("publication_uuid") ?? run.Text("publication_uuid"),
                        "expected": run.Text("publication_expected") == "" ? run.Text("state_sha"): run.Text(
                            "publication_expected"
                        ),
                        "approval": run.Text("approval"),
                        "action": "publish",
                        "metadata": PublicSummary.Attach(metadata, summary)
                    }
                )
            )
        }

        internal func Submit(args Args) {
            let directory = Path.GetFullPath(args.Need("run"))
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
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
                } catch (error Exception) {
                    run.Fields["state"] = "failed"
                    run.Fields["error"] = error.Message
                    run.Fields["elapsed_seconds"] = elapsed + Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))
                    run.Save(directory)
                    throw error
                }
                CommitPrepared(directory, run)
            }
            if args.Get("incomplete") == "true" {
                Partial(directory, run)
            }
            if File.Exists(Path.Combine(directory, "correction.json")) {
                CorrectionPublication.SubmitLocked(directory, run)
                return
            }
            let path = Path.Combine(directory, "request.json")
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
                let outcome = RequestData.Recorded(state.Value(), J.Get(viewer, "id"), saved)
                if outcome.ValueKind != JsonValueKind.Undefined {
                    if J.Text(state.Value(), "approval_id") != run.Text("approval") || J.Text(
                        J.Get(state.Value(), "reservation"),
                        "reservation"
                    ) != run.Text("id") {
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
                    let number = J.Number(outcome, "pr")
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
                    Terminal.Json(outcome, "Recorded publication outcome; no comment posted")
                    return
                }
            }
            let record = ContributionAuthority.Recheck(run)
            if run.Text("state") != (RequestData.Incomplete(run.Element()) ? "incomplete_generated": "generated") ||
                run.Text("commit") == "" {
                throw CliFailure("invalid_state", "Only an independently verified exact commit can be submitted")
            }
            if !RequestData.Incomplete(run.Element()) {
                Verification.Results(run, record)
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
                    J.Get(run.Element(), "donor_id")
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
            let request = PublicationRequest(run)
            File.WriteAllText(path, J.Write(request) + "\n")
            Request(Args([]string{"request", run.Text("repo") + "#" + run.Number("issue").ToString(), "--file", path}))
        }
    }
}
