package Tokate

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json
import System.Threading

internal class Donate {
    shared {
        internal var Active bool
        private func Running(directory string) bool {
            try {
                using let lease = RunStorage.Lease(directory)
                return false
            } catch (error IOException) {
                return true
            }
        }

        private func Report(saved JsonElement) {
            let session = map[string, Object?]{}

            for field in saved.EnumerateObject() {
                session[field.Name] = field.Value.Clone()
            }

            let usage = map[string, Object?]{"input_tokens": 0L, "cached_input_tokens": 0L, "output_tokens": 0L}
            session["usage"] = usage
            session["wall_seconds"] = 0
            for key in[]string{"submitted", "skipped", "failed", "prepared"} {
                session[key] = 0
            }
            for task in J.Items(J.Get(saved, "tasks")) {
                let directory = J.Text(task, "run_directory")
                let run = directory != "" && File.Exists(Path.Combine(directory, "run.json")) ? Data.Load(
                    directory
                ): nil
                let result = run == nil ? J.Text(task, "result"): switch run.State {
                    case "published": "submitted"
                    case "generated": "prepared"
                    case "skipped": "skipped"
                    case "refused": "skipped"
                    default: "failed"
                }
                let previous = session.GetValueOrDefault(result) is int32 count ? count: J.Number(saved, result)
                session[result] = previous + 1
                session["wall_seconds"] = Convert.ToInt32(session["wall_seconds"]) +
                    (
                    run?.HasWallSeconds == true ? run.WallSeconds: Math.Max(
                        run?.ElapsedSeconds ?? 0,
                        run?.ExecutionSeconds ?? 0
                    )
                )
                let taskUsage = run?.Usage ?? default(JsonElement)
                for key in usage.Keys {
                    let count = J.Get(taskUsage, key)
                    if count.ValueKind == JsonValueKind.Number {
                        usage[key] = Convert.ToInt64(usage[key]) + count.GetInt64()
                    }
                }
            }
            let report = J.Parse(J.Write(session))
            PublicOutput.ResultData = report
            if !PublicOutput.Enabled {
                Terminal.Json(report, "Donation report")
            }
        }

        private func WriteSession(session Dictionary[string, Object?], path string) -> Data.WriteText(
            path,
            J.Write(session) + "\n"
        )

        internal func Stop(options Args) int32 {
            let repo = options.Need("repo")
            let directory = Path.Combine(LocalPaths.StateDirectory(), "donations", repo.ToLowerInvariant())
            Terminal.Message("Stop donating to " + repo + " after the current task.", error: true)
            if !OwnerSetup.Confirm(options, "Stop donating?") {
                throw CliFailure("confirmation_required", "Donation stop requires --yes. Nothing changed.")
            }
            Directory.CreateDirectory(directory)
            if Running(directory) {
                File.WriteAllText(Path.Combine(directory, "stop"), "stop\n")
                while Running(directory) {
                    Thread.Sleep(100)
                }
            } else {
                Terminal.Message("No donation is running for " + repo + ".")
            }
            let path = Path.Combine(directory, "session.json")
            PublicOutput.ResultData = map[string, Object?]{"repo": repo}
            if File.Exists(path) {
                Report(Data.ReadElement(path))
            }
            return 0
        }

        private func Pick(repo string, attempted HashSet[int32]) int32 {
            var page int32 = 1
            while true {
                let issues = GitHub.Api(
                    "repos/" +
                        repo +
                        "/issues?state=open&labels=tokate%3Aapproved" +
                        "&sort=created&direction=asc&per_page=100&page=" +
                        page.ToString()
                )
                for issue in issues.EnumerateArray() {
                    let number = J.Number(issue, "number")
                    if attempted.Contains(number) || J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                        continue
                    }
                    return number
                }
                if issues.GetArrayLength() < 100 {
                    return 0
                }
                page++
            }
        }

        private func Task(options Args, issue int32, gratis JsonElement, publish bool) Dictionary[string, Object?] {
            options.Values["--issue"] = issue.ToString()
            var directory string = ""
            let task = map[string, Object?]{"issue": issue, "result": "submitted"}
            let timer = Stopwatch.StartNew()
            try {
                directory = ContributionPreparation.Acquire(options, gratis)
                Dispatch(Args([]string{"work", "--run", directory, "--yes", "--non-interactive"}))
                if publish {
                    Dispatch(Args([]string{"submit", "--run", directory, "--yes"}))
                }
                if gratis.ValueKind != JsonValueKind.Undefined {
                    let run = Data.Load(directory)
                    task["result"] = run.State == "published" ? "submitted":
                    !publish && run.State == "generated" ? "prepared": "skipped"
                    task["reason"] = run.State
                    task["discussion_error"] = run.DiscussionError
                    task["discussion_url"] = run.DiscussionUrl
                }
            } catch (error Exception) when !(error is CommandInterrupted) {
                directory = PublicOutput.RunDirectory
                let unclaimed = directory == "" || Data.Load(directory).Id == ""
                let ineligible = error is CliFailure &&
                    (error.Code == "invalid_state" || error.Code == "stale_approval")
                task["result"] = unclaimed && ineligible ? "skipped": "failed"
                task["error"] = error.Message
                if !unclaimed && gratis.ValueKind != JsonValueKind.Undefined && Data.Load(directory).Pr > 0 {
                    task["result"] = "submitted"
                    task["discussion_error"] = error.Message
                }
                if !unclaimed && gratis.ValueKind == JsonValueKind.Undefined {
                    ApiTransport.BeginDeadline(30)
                    try {
                        while ReservationRequest.Run(Args([]string{"release", "--run", directory})) == 8 {
                            ApiTransport.PollWait("repos/" + options.Need("repo") + "/actions/")
                        }
                    } catch (error Exception) when !(error is CommandInterrupted) {
                        Terminal.Message("Reservation release unconfirmed: " + error.Message, error: true)
                    }
                }
            } finally {
                ApiTransport.EndDeadline()
                if directory != "" && File.Exists(Path.Combine(directory, "run.json")) {
                    using let lease = RunStorage.Lease(directory)
                    let run = Data.Load(directory)
                    run.WallSeconds = Convert.ToInt32(Math.Ceiling(timer.Elapsed.TotalSeconds))
                    run.Save(directory)
                }
            }
            task["pr_url"] = directory == "" ? "": Data.Load(directory).PrUrl
            task["run_directory"] = directory
            return task
        }

        internal func Run(options Args) int32 {
            let repo = options.Need("repo")
            let issues = List[int32]()
            let selected = options.Get("issues", options.Get("issue"))
            if selected != "" {
                for number in selected.Split(',') {
                    issues.Add(Int32.Parse(number))
                }
            }
            let directory = Path.Combine(LocalPaths.StateDirectory(), "donations", repo.ToLowerInvariant())
            let total = options.Get("total") == "" ? Double.PositiveInfinity: Convert.ToDouble(options.Number("total"))
            let info = GitHub.Api("repos/" + repo)
            let revision = GitHub.Branch(repo, J.Text(info, "default_branch"))
            let policyFile = GitHub.Api(
                "repos/" + repo + "/contents/.github/tokate.json?ref=" + revision,
                missing: true
            )
            let gratis = policyFile.ValueKind == JsonValueKind.Undefined
            if !gratis && options.Get("review") == "true" {
                throw CliFailure("invalid_arguments", "--review requires a repository without a Tokate policy")
            }
            if !gratis && issues.Count > 0 {
                throw CliFailure("invalid_arguments", "Issue lists require a repository without a Tokate policy")
            }
            let invalid = List[string]()
            for number in issues {
                let issue = GitHub.Api("repos/" + repo + "/issues/" + number.ToString(), missing: true)
                let reason = J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined ? "a pull request":
                J.Text(issue, "state") != "open" ? "closed": J.Bool(issue, "locked") ? "locked": ""
                if reason != "" {
                    invalid.Add(repo + "#" + number.ToString() + " is " + reason)
                }
            }
            if invalid.Count > 0 {
                throw CliFailure("invalid_state", "Gratis work cannot use these issues: " + String.Join(", ", invalid))
            }
            if gratis && options.Get("unlimited") == "true" {
                throw CliFailure("invalid_arguments", "Gratis work uses --time, not --unlimited")
            }
            if !gratis && options.Get("prompt") != "" {
                throw CliFailure("invalid_arguments", "--prompt requires a repository without a Tokate policy")
            }
            let policy = gratis ? Gratis.PolicyFor(options): Policy.Load(repo, revision)
            let guidance = gratis ? GratisGuidance.Find(repo, revision): Dictionary[string, Object?]()
            let prompt = gratis ? GratisGuidance.Prompt(options.Get("prompt"), issues.Count > 0): ""
            let context = map[string, Object?]{
                "policy": policy.Value,
                "approval": map[string, Object?]{
                    "base": revision,
                    "base_branch": J.Text(info, "default_branch"),
                    "policy_hash": policy.Digest
                },
                "guidance": guidance,
                "prompt": prompt,
                "prompt_sha256": J.Hash(prompt)
            }
            if gratis {
                Gratis.Context(context, List[Object]())
            }
            let maximum = gratis ? 3600: Math.Min(3600, policy.MaxSeconds)
            let seconds = options.Get("seconds") == "" ? maximum: options.Number("seconds")
            options.Values["--seconds"] = seconds.ToString()
            policy.ValidateBudget(seconds, false)
            let selection = SelectionPolicy.Resolve(options, policy)
            let limit = issues.Count > 0 ? issues.Count.ToString() +
                (issues.Count == 1 ? " task": " tasks"): Double.IsPositiveInfinity(total) ? "until stopped":
            total.ToString() + " seconds"
            var consent = repo + (issues.Count > 0 ? "#" + selected: "") + "\nHarness: " + J.Text(
                selection,
                "harness"
            ) +
                "\nModel: " +
                J.Text(selection, "model") + "\nEffort: " + J.Text(selection, "effort") +
                "\nPer task: " +
                seconds.ToString() + " seconds\nTotal: " + limit
            if J.Text(selection, "harness") == "command" {
                consent += "\nCommand: " + CommandHarness.Text(selection)
                options.Values["--consented-command"] = J.Write(J.Get(selection, "command"))
            }
            if gratis {
                consent += "\nGratis mode. No owner approved the task.\nGuidance: " + String.Join(", ", guidance.Keys) +
                    "\nTask instruction:\n" +
                    prompt
            }
            Terminal.Message(consent, error: true)
            if !OwnerSetup.Confirm(options, "Start donating?") {
                throw CliFailure(
                    "confirmation_required",
                    "Repository work requires --yes. No claim or inference started."
                )
            }

            return RunSession(options, issues, directory, total, gratis, context, selection, seconds)
        }

        private func RunSession(
            options Args,
            issues List[int32],
            directory string,
            total float64,
            gratis bool,
            context Dictionary[string, Object?],
            selection JsonElement,
            seconds int32
        ) int32 {
            let repo = options.Need("repo")
            let marker = Path.Combine(directory, "stop")

            options.Values["--yes"] = "true"
            Directory.CreateDirectory(directory)
            using let lease = RunStorage.Lease(directory)
            File.Delete(marker)
            for key in[]string{"harness", "provider", "model", "effort"} {
                options.Values["--" + key] = J.Text(selection, key)
            }
            let timer = Stopwatch.StartNew()
            let tasks = List[Object]()
            let attempted = HashSet[int32]()
            var consecutive int32
            var first bool = true
            let session = map[string, Object?]{"repo": repo, "tasks": tasks, "reason": "stopped"}
            let sessionPath = Path.Combine(directory, "session.json")
            WriteSession(session, sessionPath)
            Active = true
            try {
                while !File.Exists(marker) {
                    if consecutive == 3 || seconds > total - (first ? 0: timer.Elapsed.TotalSeconds) {
                        session["reason"] = consecutive == 3 ? "consecutive_failures": "total_exhausted"
                        break
                    }
                    PublicOutput.RunDirectory = ""
                    let pulls = gratis ? Gratis.Snapshot(repo): List[Object]()
                    let issue = issues.Count > 0 ? issues[tasks.Count]: gratis ? 0: Pick(repo, attempted)
                    if File.Exists(marker) || seconds > total - (first ? 0: timer.Elapsed.TotalSeconds) {
                        continue
                    }
                    first = false
                    if issue == 0 && !gratis {
                        Terminal.Message("No eligible issues. Checking again in 10 minutes.")
                        let next = Math.Min(timer.Elapsed.TotalSeconds + 600, total - seconds)
                        while !File.Exists(marker) && timer.Elapsed.TotalSeconds < next {
                            Thread.Sleep(1000)
                        }
                        continue
                    }
                    attempted.Add(issue)
                    if gratis {
                        context["issue"] = issue == 0 ? map[string, Object?]{
                            "title": "Tokate donation",
                            "body": "Choose a task from the repository and its guidance."
                        }: GitHub.Issue(repo, issue)
                    }
                    let task = Task(
                        options,
                        issue,
                        gratis ? Gratis.Context(context, pulls): JsonElement{},
                        options.Get("review") != "true"
                    )
                    tasks.Add(task)
                    let result = task["result"]?.ToString() ?? ""
                    consecutive = result == "failed" ? consecutive + 1: 0
                    WriteSession(session, sessionPath)
                    if issues.Count > 0 && tasks.Count == issues.Count {
                        session["reason"] = result == "prepared" || result == "submitted" ? "issues_completed":
                        task.GetValueOrDefault("reason") ?? result
                        break
                    }
                    let refused = task.GetValueOrDefault("reason")?.ToString() == "refused"
                    if gratis &&
                        (
                        refused ||
                            (
                            issue == 0 && result != "failed" && result != "prepared" && task["pr_url"]?.ToString() == ""
                        )
                    ) {
                        session["reason"] = refused ? "refused": "no_pr"
                        break
                    }
                }
            } finally {
                Active = false
                File.Delete(marker)
                PublicOutput.RunDirectory = ""
                PublicOutput.Actions.Clear()
                WriteSession(session, sessionPath)
                Report(J.Parse(J.Write(session)))
                for item in tasks {
                    if item is Dictionary[string, Object?]task && task["result"]?.ToString() == "prepared" {
                        let next = []string{"tokate", "submit", "--run", task["run_directory"]?.ToString() ?? ""}
                        PublicOutput.Actions.Add(next)
                        Terminal.Message("Next: " + Terminal.Command(next), error: true)
                    }
                }
            }
            return consecutive == 3 ||
                (
                issues.Count > 0 && tasks.Exists(
                    task -> task is Dictionary[string, Object?]item && item["result"]?.ToString() == "failed"
                )
            ) ? 1: 0
        }
    }
}
