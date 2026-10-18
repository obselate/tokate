package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Text
import System.Text.Json

internal class FeedbackRevision {
    shared {
        private const RoundLimit int32 = 3
        private const TextByteLimit int32 = 16384

        internal func Options(args Args) {
            let run = Data.Load(Path.GetFullPath(args.Need("run")))
            args.Need("seconds")
            let same = args.Get("harness", run.Harness) == run.Harness
            if args.Get("harness") == "" {
                args.Values["--harness"] = run.Harness
            }
            if same && args.Get("provider") == "" {
                args.Values["--provider"] = run.Provider
            }
            for (option, value) in map[string, string]{"model": run.Model, "effort": run.Effort} {
                if args.Get(option) == "" {
                    args.Values["--" + option] = value
                }
            }
            if same {
                for (option, value) in map[string, string]{
                    "harness-path": run.HarnessPath,
                    "claude-profile": run.ClaudeProfile,
                    "endpoint": run.PiEndpoint,
                    "pi-root": run.PiRoot,
                    "node": run.PiNode
                } {
                    if args.Get(option) == "" && value != "" {
                        args.Values["--" + option] = value
                    }
                }
            }
            SelectionPolicy.NormalizePair(args)
        }

        private func Fields(value JsonElement, keys string) Dictionary[string, Object?] {
            let fields = map[string, Object?]{}
            for key in keys.Split(',') {
                let item = J.Get(value, key)
                if item.ValueKind != JsonValueKind.Undefined {
                    fields[key] = item.Clone()
                }
            }
            return fields
        }

        private func Location(directory string, round int32) string -> Path.Combine(
            directory,
            "feedback",
            round.ToString(CultureInfo.InvariantCulture)
        )

        internal func Pending(directory string, run Data) bool -> run.FeedbackRound > 0 && Data.Load(
            Location(directory, run.FeedbackRound)
        )
            .State == "generated"

        private func Record(run Data, harness string, provider string) JsonElement {
            let record = run.Gratis ? run.GratisContext: J.Get(Amendment.Authority(run, nil), "record")
            if !run.Gratis {
                return record
            }
            ContributionAuthority.Recheck(run)
            let fields = Fields(record, "policy,approval,issue,guidance,prompt,prompt_sha256,snapshot")
            let policy = map[string, Object?]{}
            for field in J.Get(record, "policy").EnumerateObject() {
                policy[field.Name] = field.Value.Clone()
            }
            policy["allowed_tools"] = []Object{map[string, Object?]{"harness": harness, "provider": provider}}
            fields["policy"] = policy
            return J.Parse(J.Write(fields))
        }

        private func Published(run Data) {
            Publication.Require(
                run.State == "published" && run.Pr > 0 && run.Source == "tokate" && run.FeedbackPrevious == "",
                "Feedback requires the original published harness run"
            )
            Amendment.Pull(run, run.Pr, run.Commit, "")
        }

        private func Cut(text string, limit int32) string {
            let bytes = Encoding.UTF8.GetBytes(text)
            if bytes.Length <= limit {
                return text
            }
            var end = limit
            while end > 0 && (bytes[end] & 0xc0) == 0x80 {
                end--
            }
            return Encoding.UTF8.GetString(bytes, 0, end)
        }

        private func Timestamp(item JsonElement) string -> J.Text(item, "submitted_at") == "" ? J.Text(
            item,
            "created_at"
        ): J.Text(item, "submitted_at")

        private func Feedback(directory string, run Data, authors List[string]) string {
            var approver int64
            if !run.Gratis {
                let authority = Amendment.Authority(run, nil)
                approver = CoordinationState.Parse(J.Get(authority, "state")).Approval?.Approver ?? 0
                if approver <= 0 {
                    throw CliFailure(
                        "invalid_state",
                        "Approval predates approver identity. Feedback revisions are not available for this run."
                    )
                }
            }
            var published DateTimeOffset
            if run.PublishedAt == "" || run.PublishedHead != run.Commit {
                Publication.Require(
                    J.Items(run.Amendments).Count == 0,
                    "Published head time is unavailable for this amended run"
                )
                Publication.ObserveHead(run, Amendment.Pull(run, run.Pr, run.Commit, ""), run.Commit, original: true)
                run.Save(directory)
            }
            let stamp = run.PublishedAt
            Publication.Require(
                DateTimeOffset.TryParse(stamp, CultureInfo.InvariantCulture, DateTimeStyles.None, out published),
                "Published head time is unavailable"
            )
            let items = List[JsonElement]()
            let counted = HashSet[string](StringComparer.OrdinalIgnoreCase)
            let prefix = "repos/" + run.Repo + "/"
            let number = run.Pr.ToString()
            for source in[]string{
                "pulls/" + number + "/reviews",
                "pulls/" + number + "/comments",
                "issues/" + number + "/comments"
            } {
                for page in 1 ... GitHub.PageCountLimit + 1 {
                    let response = GitHub.Api(
                        prefix + source + "?" + GitHub.PageSizeParameter + "&page=" + page.ToString()
                    )
                    Publication.Require(response.ValueKind == JsonValueKind.Array, "PR feedback is unavailable")
                    for item in response.EnumerateArray() {
                        var created DateTimeOffset
                        let timestamp = Timestamp(item)
                        if J.Text(item, "body").Trim() == "" || !DateTimeOffset.TryParse(
                            timestamp,
                            CultureInfo.InvariantCulture,
                            DateTimeStyles.None,
                            out created
                        ) ||
                            created <= published {
                            continue
                        }
                        let author = J.Text(J.Get(item, "user"), "login")
                        if author == "" {
                            continue
                        }
                        let association = J.Text(item, "author_association")
                        let allowed = run.Gratis ? association == "OWNER" ||
                            association == "MEMBER" ||
                            association == "COLLABORATOR": JsonFields.OptionalInt64(
                            J.Get(item, "user"),
                            "Feedback author",
                            "id",
                            0
                        ) == approver
                        if allowed {
                            if counted.Add(author) {
                                authors.Add(author)
                            }
                            items.Add(item.Clone())
                        }
                    }
                    if response.GetArrayLength() < GitHub.PageSize {
                        break
                    }
                    Publication.Require(page < GitHub.PageCountLimit, "PR feedback history exceeds the read limit")
                }
            }
            if items.Count == 0 {
                throw CliFailure("no_feedback", "No new qualifying feedback on PR " + run.PrUrl)
            }
            items.Sort((left, right) -> String.CompareOrdinal(Timestamp(left), Timestamp(right)))
            var text = ""
            for item in items {
                text += (
                    "Author: " + J.Text(J.Get(item, "user"), "login") + "\nURL: " + J.Text(item, "html_url") +
                        "\n" +
                        J.Text(item, "body") + "\n\n"
                )
                if Encoding.UTF8.GetByteCount(text) > TextByteLimit {
                    let notice = "\nFeedback truncated at " + TextByteLimit.ToString() + " bytes.\n"
                    return Cut(text, TextByteLimit - Encoding.UTF8.GetByteCount(notice)) + notice
                }
            }
            return text
        }

        internal func Work(directory string, args Args, check async () -> void) {
            using let lease = RunStorage.Lease(directory)
            let run = Data.Load(directory)
            Published(run)
            let rounds = J.Items(run.FeedbackRuns)
            if rounds.Count >= RoundLimit {
                throw CliFailure(
                    "feedback_limit",
                    "PR " + run.PrUrl + " has reached the limit of " + RoundLimit.ToString() + " feedback runs"
                )
            }
            Publication.Require(
                !Pending(directory, run),
                "Submit the saved feedback revision before another feedback run"
            )
            for key in[]string{"unlimited", "continue-from", "total", "prompt", "fork"} {
                if args.Get(key) != "" {
                    throw CliFailure("invalid_arguments", "--feedback cannot use --" + key)
                }
            }
            if !run.Gratis && args.Get("review") == "true" {
                throw CliFailure("invalid_arguments", "--review requires gratis work")
            }
            let authors = List[string]()
            let feedback = Feedback(directory, run, authors)
            await check()
            let record = Record(run, args.Need("harness"), args.Need("provider"))
            let policy = Policy(J.Get(record, "policy"))
            policy.Digest = run.Gratis ? policy.Digest: run.PolicyHash
            let seconds = args.Number("seconds")
            policy.ValidateBudget(seconds, false)
            let selection = SelectionPolicy.Resolve(args, policy)
            let revision = Data.Parse(
                J.Parse(
                    J.Write(
                        Fields(
                            run.Element(),
                            "version,repo,issue,id,attempt,donor,donor_id,head_repo,approval,base,base_branch,branch,source,gratis,gratis_context,preparation_version,preparation_repo_id,preparation_head_id,pr,pr_url"
                        )
                    )
                )
            )
            revision.State = "claimed"
            revision.FeedbackPrevious = run.Commit
            revision.FeedbackText = feedback
            revision.FeedbackAuthors = String.Join(", ", authors)
            revision.FeedbackRound = rounds.Count + 1
            revision.Seconds = seconds
            if args.Get("verification-reserve") != "" {
                revision.VerificationReserve = RuntimeBudget.Reserve(args, seconds)
            }
            revision.PolicyHash = policy.Digest
            revision.Selection = selection
            revision.Harness = J.Text(selection, "harness")
            revision.Provider = J.Text(selection, "provider")
            revision.Model = J.Text(selection, "model")
            revision.RequestedModel = revision.Model
            revision.Effort = J.Text(selection, "effort")
            revision.Tools = J.Parse(J.Write([]Object{J.Select(selection, "harness,provider,model,effort")}))
            revision.HarnessPath = args.Get("harness-path") == "" ? "": LocalPaths.RuntimePath(args.Get("harness-path"))
            revision.ClaudeProfile = args.Get("claude-profile")
            revision.PiEndpoint = args.Get("endpoint")
            revision.PiRoot = args.Get("pi-root")
            revision.PiNode = args.Get("node")
            RuntimeBudget.Validate(revision)
            Output.Sink.ConfirmSelection(args, selection, revision)
            let location = Start(directory, run, revision, rounds)
            try {
                Commands.Git(
                    directory,
                    "-c",
                    "protocol.file.allow=always",
                    "clone",
                    "--quiet",
                    "--no-hardlinks",
                    "--",
                    Path.Combine(directory, "checkout"),
                    Path.Combine(location, "checkout")
                )
                HarnessRunner.Execute(location, args)
            } catch (error Exception) when ExecutionFailure.Handled(error) {
                let failed = Data.Load(location)
                if failed.State == "claimed" {
                    failed.Transition("failed")
                    failed.Error = error.Message
                    failed.Save(location)
                }
                throw error
            } finally {
                let finished = Data.Load(location)
                if finished.State == "failed" {
                    Fail(directory, run, finished)
                } else {
                    Update(directory, run, finished)
                }
            }
            if args.Get("review") != "true" {
                Publish(directory, Data.Load(directory))
            }
            if Pending(directory, Data.Load(directory)) {
                Output.Sink.Actions.Add([]string{"tokate", "submit", "--run", directory, "--yes"})
                Output.Sink.Message("Feedback revision saved. Inspect status, then use tokate submit to publish it.")
            }
        }

        private func Start(directory string, run Data, revision Data, rounds List[JsonElement]) string {
            let checkout = Verification.Candidate(Path.Combine(directory, "checkout"))
            Publication.Require(
                Commands.Git(checkout, "rev-parse", "HEAD") == run.Commit && Commands.Git(
                    checkout,
                    "status",
                    "--porcelain"
                ) == "",
                "Published checkout changed"
            )
            if !run.Gratis {
                OriginalEvidence.Capture(directory, run)
            }
            let location = Location(directory, revision.FeedbackRound)
            Directory.CreateDirectory(Path.Combine(directory, "feedback"))
            LocalPaths.DirectoryPath(Path.Combine(directory, "feedback"))
            Publication.Require(
                !Directory.Exists(location) && !File.Exists(location),
                "Feedback destination already exists"
            )
            Directory.CreateDirectory(location)
            revision.Save(location)
            run.FeedbackRound = revision.FeedbackRound
            rounds.Add(Row(revision))
            run.FeedbackRuns = J.Parse(J.Write(rounds))
            run.Save(directory)
            return location
        }

        private func Row(run Data, state string = "") JsonElement {
            let fields = Fields(
                run.Element(),
                "feedback_round,feedback_previous,state,commit,harness,provider,model,effort,seconds,execution_seconds,verification_seconds"
            )
            if run.Usage.ValueKind == JsonValueKind.Object {
                fields["usage"] = RequestUsage.Counts(run.Usage)
            }
            if state != "" {
                fields["state"] = state
            }
            return J.Parse(J.Write(fields))
        }

        private func Update(directory string, run Data, revision Data) {
            let rounds = J.Items(run.FeedbackRuns)
            rounds[revision.FeedbackRound - 1] = Row(revision)
            run.FeedbackRuns = J.Parse(J.Write(rounds))
            run.Save(directory)
        }

        private func Fail(directory string, run Data, revision Data) {
            revision.Transition("failed")
            revision.Save(Location(directory, revision.FeedbackRound))
            Update(directory, run, revision)
            Commands.Git(Path.Combine(directory, "checkout"), "checkout", "--quiet", "--detach", run.Commit)
        }

        internal func Recheck(location string, revision Data) JsonElement {
            let directory = Path.GetDirectoryName(Path.GetDirectoryName(location)) ?? ""
            let run = Data.Load(directory)
            Published(run)
            Publication.Require(
                run.FeedbackRound == revision.FeedbackRound && run.Commit == revision.FeedbackPrevious,
                "Feedback published head changed"
            )
            let record = Record(run, revision.Harness, revision.Provider)
            let policy = Policy(J.Get(record, "policy"))
            policy.ValidateBudget(revision.Seconds, false)
            policy.ValidateTools(revision.Tools, "tokate")
            return record
        }

        internal func Ready(location string, run Data) {
            let checkout = Verification.Candidate(Path.Combine(location, "checkout"))
            Publication.Require(
                Commands.Git(checkout, "rev-parse", "HEAD") == run.FeedbackPrevious && Commands.Git(
                    checkout,
                    "status",
                    "--porcelain"
                ) == "",
                "Feedback checkout changed before inference"
            )
        }

        internal func Finish(location string, run Data, record JsonElement, timer Stopwatch) {
            let budget = RuntimeBudget(timer, run.Seconds - run.VerificationReserve)
            let checkout = Verification.Candidate(Path.Combine(location, "checkout"), budget)
            PublicSummary.Capture(location, checkout, run)
            Publication.Require(budget.Git(checkout, "status", "--porcelain") != "", "Feedback returned no changes")
            let patch = Contribution.Snapshot(checkout, run, budget)
            Contribution.CheckPaths(checkout, record, run, budget: budget)
            PublicSummary.Bind(run, patch)
            File.WriteAllText(Path.Combine(location, "changes.patch"), patch)
            budget.Git(
                checkout,
                "-c",
                "user.name=" + run.Donor,
                "-c",
                "user.email=" + RepositoryIdentity.Email(run.DonorId, run.Donor),
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "Address maintainer feedback"
            )
            run.Commit = budget.Git(checkout, "rev-parse", "HEAD")
            let summary = PublicSummary.ForHead(run, run.Commit)
            if summary.ValueKind != JsonValueKind.Undefined {
                run.PublicSummary = summary
            }
            let tool = J.Select(run.Element(), "harness,provider,model,effort")
            tool["coding_seconds"] = run.ExecutionSeconds
            tool["usage"] = RequestUsage.Counts(run.Usage)
            run.Tools = J.Parse(J.Write([]Object{tool}))
            run.VerificationSeconds = run.Seconds - Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))
            if !run.Gratis && run.VerificationSeconds < 1 {
                throw CliFailure("command_failed", "No time remains for owner verification")
            }
            budget.Remaining()
            File.WriteAllText(Path.Combine(location, "tools.json"), J.Write(run.Tools))
            if run.PublicSummary.ValueKind != JsonValueKind.Undefined {
                File.WriteAllText(Path.Combine(location, "summary.json"), J.Write(run.PublicSummary))
            }
            run.Transition("generated")
            run.ClearFailureReason()
            run.ClearFailureStage()
            run.Save(location)
        }

        internal func Publish(
            directory string,
            run Data,
            confirm Func[Dictionary[string, Object?], string, bool]? = nil
        ) {
            Publication.Require(Pending(directory, run), "No saved feedback revision is ready")
            let location = Location(directory, run.FeedbackRound)
            let revision = Data.Load(location)
            let checkout = Verification.Candidate(Path.Combine(location, "checkout"))
            Publication.Require(
                Commands.Git(checkout, "rev-parse", "HEAD") == revision.Commit && Commands.Git(
                    checkout,
                    "status",
                    "--porcelain"
                ) == "",
                "Saved feedback candidate changed"
            )
            let target = Verification.Candidate(Path.Combine(directory, "checkout"))
            let head = Commands.Git(target, "rev-parse", "HEAD")
            Publication.Require(
                (head == revision.FeedbackPrevious || head == revision.Commit) && Commands.Git(
                    target,
                    "status",
                    "--porcelain"
                ) == "",
                "Published checkout changed"
            )
            if run.Gratis {
                if !PublishGratis(directory, location, run, revision, confirm) {
                    return
                }
            } else {
                if head != revision.Commit {
                    Recheck(location, revision)
                    Commands.Git(
                        target,
                        "-c",
                        "protocol.file.allow=always",
                        "fetch",
                        "--quiet",
                        "--no-tags",
                        "--no-recurse-submodules",
                        "--",
                        checkout,
                        revision.Commit
                    )
                    Commands.Git(target, "checkout", "--quiet", "--detach", revision.Commit)
                }
                let args = List[string]{
                    "amend",
                    "--run",
                    directory,
                    "--commit",
                    revision.Commit,
                    "--time",
                    revision.VerificationSeconds.ToString() + "s",
                    "--tools",
                    Path.Combine(location, "tools.json"),
                    "--yes"
                }
                if File.Exists(Path.Combine(location, "summary.json")) {
                    args.AddRange([]string{"--summary", Path.Combine(location, "summary.json")})
                }
                try {
                    Amendment.AmendSaved(Args(args.ToArray()), directory, run)
                } catch (error CliFailure) when error.Code == "verification_failed" {
                    Fail(directory, Data.Load(directory), revision)
                    throw error
                }
                if Data.Load(directory).Commit != revision.Commit {
                    return
                }
            }
            revision.Transition("published")
            revision.Save(location)
            Update(directory, Data.Load(directory), revision)
        }

        private func PublishGratis(
            directory string,
            location string,
            run Data,
            revision Data,
            confirm Func[Dictionary[string, Object?], string, bool]?
        ) bool {
            ContributionAuthority.Recheck(run)
            let pull = Amendment.Pull(run, run.Pr, revision.FeedbackPrevious, revision.Commit)
            if J.Text(J.Get(pull, "head"), "sha") == revision.Commit {
                Publication.ObserveHead(run, pull, revision.Commit)
                run.Save(directory)
            }
            let remote = GitHub.Branch(run.HeadRepo, run.Branch)
            Publication.Require(
                remote == revision.FeedbackPrevious || remote == revision.Commit,
                "Gratis PR branch changed"
            )
            let previous = PrBody.Receipt(J.Text(pull, "body"))
            Publication.Require(
                RepositoryIdentity.SameRepo(previous.Repo, run.Repo) &&
                    previous.Reservation == run.Id &&
                    previous.Issue == run.Issue &&
                    (previous.Head == revision.FeedbackPrevious || previous.Head == revision.Commit),
                "Gratis feedback receipt changed"
            )
            let receipt = previous.ToJson()
            let updated = map[string, Object?]{}
            for field in receipt.EnumerateObject() {
                updated[field.Name] = field.Value.Clone()
            }
            let originalTools = List[Object]()
            for original in J.Items(J.Get(receipt, "tools")) {
                let tool = J.Select(original, "harness,provider,model,effort,coding_seconds")
                tool["usage"] = RequestUsage.Counts(J.Get(original, "usage"))
                originalTools.Add(tool)
            }
            updated["tools"] = originalTools
            updated["head"] = revision.Commit
            updated.Remove("summary")
            PublicSummary.Attach(updated, revision.PublicSummary)
            let rounds = J.Items(run.FeedbackRuns)
            rounds[rounds.Count - 1] = Row(revision, "published")
            updated["feedback_runs"] = rounds
            let body = PrBody.ReplaceBody(
                J.Text(pull, "body"),
                PrBody.PublicReport(J.Parse(J.Write(updated))) + PublicSummary.Tools(
                    revision.Tools,
                    "Feedback run tools"
                ),
                J.Parse(J.Write(updated))
            )
            let preview = map[string, Object?]{
                "repo": run.Repo,
                "pr": run.Pr,
                "head": revision.Commit,
                "body": body,
                "applied": false
            }
            if confirm != nil &&
                !confirm(preview, "PR: " + run.PrUrl + "\nHead: " + revision.Commit + "\nBody:\n" + body) {
                return false
            }
            File.WriteAllText(
                Path.Combine(location, "publication.json"),
                J.Write(map[string, Object?]{"head": revision.Commit, "body": body})
            )
            if remote != revision.Commit {
                Publication.Push(Path.Combine(location, "checkout"), run, revision.Commit)
            }
            ContributionAuthority.Recheck(run)
            let observed = Amendment.Pull(run, run.Pr, revision.Commit, "")
            Publication.ObserveHead(run, observed, revision.Commit)
            run.Save(directory)
            Publication.Require(
                GitHub.Branch(run.HeadRepo, run.Branch) == revision.Commit,
                "Gratis feedback head was not published"
            )
            GitHub.Api(
                "repos/" + run.Repo + "/pulls/" + run.Pr.ToString(),
                map[string, Object?]{"body": body},
                method: "PATCH"
            )
            run.Commit = revision.Commit
            Publication.SavePr(directory, run, observed)
            let target = Verification.Candidate(Path.Combine(directory, "checkout"))
            Publication.Require(Commands.Git(target, "status", "--porcelain") == "", "Published checkout changed")
            Commands.Git(
                target,
                "-c",
                "protocol.file.allow=always",
                "fetch",
                "--quiet",
                "--no-tags",
                "--no-recurse-submodules",
                "--",
                Path.Combine(location, "checkout"),
                revision.Commit
            )
            Commands.Git(target, "checkout", "--quiet", "--detach", revision.Commit)
            preview["applied"] = true
            return true
        }
    }
}
