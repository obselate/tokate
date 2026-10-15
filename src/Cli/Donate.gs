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

        private func Report(session JsonElement) {
            PublicOutput.ResultData = session
            if !PublicOutput.Enabled {
                Terminal.Json(session, "Donation report")
            }
        }

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
                Report(Data.Read(path).Element())
            }
            return 0
        }

        private func Pick(repo string, attempted HashSet[int32], query string, pulls JsonElement) int32 {
            var page int32 = 1
            while true {
                let issues = GitHub.Api(
                    "repos/" +
                        repo +
                        "/issues?state=open" +
                        query +
                        "&sort=created&direction=asc&per_page=100&page=" +
                        page.ToString()
                )
                for issue in issues.EnumerateArray() {
                    let number = J.Number(issue, "number")
                    if attempted.Contains(number) || J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                        continue
                    }
                    if query == "" {
                        if J.Bool(issue, "locked") || J.Count(J.Get(issue, "assignees")) > 0 {
                            continue
                        }
                        var covered bool
                        for pull in J.Items(pulls) {
                            for linked in J.Items(J.Get(pull, "issues")) {
                                covered = covered || linked.GetInt32() == number
                            }
                        }
                        if covered {
                            continue
                        }
                    }
                    return number
                }
                if issues.GetArrayLength() < 100 {
                    return 0
                }
                page++
            }
        }

        private func Task(options Args, issue int32, gratis JsonElement) Dictionary[string, Object?] {
            options.Values["--issue"] = issue.ToString()
            var directory string = ""
            let task = map[string, Object?]{"issue": issue, "result": "submitted"}
            try {
                directory = ContributionPreparation.Acquire(options, gratis)
                Dispatch(Args([]string{"work", "--run", directory, "--yes", "--non-interactive"}))
                Dispatch(Args([]string{"submit", "--run", directory}))
                if gratis.ValueKind != JsonValueKind.Undefined {
                    let run = Data.Load(directory)
                    task["result"] = run.Text("state") == "published" ? "submitted": "skipped"
                    task["reason"] = run.Text("state")
                    task["discussion_error"] = run.Text("discussion_error")
                    task["discussion_url"] = run.Text("discussion_url")
                }
            } catch (error Exception) when !(error is CommandInterrupted) {
                directory = PublicOutput.RunDirectory
                let unclaimed = directory == "" || Data.Load(directory).Text("id") == ""
                let ineligible = error is CliFailure &&
                    (error.Code == "invalid_state" || error.Code == "stale_approval")
                task["result"] = unclaimed && ineligible ? "skipped": "failed"
                task["error"] = error.Message
                if !unclaimed && gratis.ValueKind != JsonValueKind.Undefined && Data.Load(directory).Number("pr") > 0 {
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
            }
            task["pr_url"] = directory == "" ? "": Data.Load(directory).Text("pr_url")
            task["run_directory"] = directory
            return task
        }

        internal func Run(options Args) int32 {
            let repo = options.Need("repo")
            let named = options.Get("issue") == "" ? 0: options.Number("issue")
            let directory = Path.Combine(LocalPaths.StateDirectory(), "donations", repo.ToLowerInvariant())
            let marker = Path.Combine(directory, "stop")
            let total = options.Get("total") == "" ? Double.PositiveInfinity: Convert.ToDouble(options.Number("total"))
            let info = GitHub.Api("repos/" + repo)
            let revision = GitHub.Branch(repo, J.Text(info, "default_branch"))
            let policyFile = GitHub.Api(
                "repos/" + repo + "/contents/.github/tokate.json?ref=" + revision,
                missing: true
            )
            let gratis = policyFile.ValueKind == JsonValueKind.Undefined
            if named > 0 && gratis {
                let issue = GitHub.Api("repos/" + repo + "/issues/" + named.ToString())
                if J.Text(issue, "state") != "open" || J.Bool(issue, "locked") || J.Get(issue, "pull_request")
                    .ValueKind != JsonValueKind
                    .Undefined {
                    throw CliFailure(
                        "invalid_state",
                        "Gratis work requires an open, unlocked issue, not a pull request"
                    )
                }
                if options.Get("unlimited") == "true" {
                    throw CliFailure("invalid_arguments", "Gratis work uses --time, not --unlimited")
                }
            }
            if !gratis && options.Get("prompt") != "" {
                throw CliFailure("invalid_arguments", "--prompt requires a repository without a Tokate policy")
            }
            let policy = gratis ? Gratis.PolicyFor(options): Policy.Load(repo, revision)
            let guidance = gratis ? GratisGuidance.Find(repo, revision): Dictionary[string, Object?]()
            let prompt = gratis ? GratisGuidance.Prompt(options.Get("prompt")): ""
            let context = map[string, Object?]{
                "policy": policy.Value,
                "approval": map[string, Object?]{
                    "base": revision,
                    "base_branch": J.Text(info, "default_branch"),
                    "policy_hash": policy.Digest
                },
                "guidance": guidance,
                "prompt": prompt,
                "prompt_sha256": Data.Hash(prompt)
            }
            if gratis {
                Gratis.Context(context, List[Object]())
            }
            let maximum = gratis ? 3600: Math.Min(3600, J.Number(policy.Value, "max_seconds"))
            let seconds = options.Get("seconds") == "" ? maximum: options.Number("seconds")
            options.Values["--seconds"] = seconds.ToString()
            policy.ValidateBudget(seconds, false)
            let selection = DonorSelection.Resolve(options, policy)
            let limit = named > 0 ? "one task": Double.IsPositiveInfinity(total) ? "until stopped":
            total.ToString() + " seconds"
            var consent = repo + (named > 0 ? "#" + named.ToString(): "") + "\nHarness: " + J.Text(
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
            let usage = map[string, Object?]{"input_tokens": 0L, "cached_input_tokens": 0L, "output_tokens": 0L}
            let session = Data(
                map[string, Object?]{
                    "repo": repo,
                    "tasks": tasks,
                    "usage": usage,
                    "reason": "stopped",
                    "submitted": 0,
                    "skipped": 0,
                    "failed": 0
                }
            )
            let sessionPath = Path.Combine(directory, "session.json")
            session.Write(sessionPath)
            Active = true
            try {
                while !File.Exists(marker) {
                    if consecutive == 3 || seconds > total - timer.Elapsed.TotalSeconds {
                        session.Fields["reason"] = consecutive == 3 ? "consecutive_failures": "total_exhausted"
                        break
                    }
                    PublicOutput.RunDirectory = ""
                    let pulls = gratis ? Gratis.Snapshot(repo): List[Object]()
                    let issue = named > 0 ? named: gratis &&
                        guidance.Count > 0 ? 0: Pick(
                        repo,
                        attempted,
                        gratis ? "": "&labels=tokate%3Aapproved",
                        J.Parse(J.Write(pulls))
                    )
                    if File.Exists(marker) || seconds > total - timer.Elapsed.TotalSeconds {
                        continue
                    }
                    if issue == 0 && !(gratis && guidance.Count > 0) {
                        if gratis {
                            session.Fields["reason"] = "no_eligible_issues"
                            Terminal.Message("No unassigned, unlocked open issue without a linked open PR remains.")
                            break
                        }
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
                            "body": "Choose a task from the repository guidance."
                        }: GitHub.Issue(repo, issue)
                    }
                    let task = Task(options, issue, gratis ? Gratis.Context(context, pulls): JsonElement{})
                    tasks.Add(task)
                    let result = task["result"]?.ToString() ?? ""
                    session.Fields[result] = session.Number(result) + 1
                    consecutive = result == "failed" ? consecutive + 1: 0
                    let runDir = task["run_directory"]?.ToString() ?? ""
                    let taskUsage = runDir == "" ? JsonElement{}: J.Get(Data.Load(runDir).Element(), "usage")
                    for key in[]string{"input_tokens", "cached_input_tokens", "output_tokens"} {
                        let count = J.Get(taskUsage, key)
                        if count.ValueKind == JsonValueKind.Number {
                            usage[key] = Convert.ToInt64(usage[key]) + count.GetInt64()
                        }
                    }
                    session.Write(sessionPath)
                    if named > 0 {
                        session.Fields["reason"] = "issue_completed"
                        break
                    }
                    let refused = task.GetValueOrDefault("reason")?.ToString() == "refused"
                    if gratis && (refused || (issue == 0 && task["pr_url"]?.ToString() == "")) {
                        session.Fields["reason"] = refused ? "refused": "no_pr"
                        break
                    }
                }
            } finally {
                Active = false
                File.Delete(marker)
                PublicOutput.RunDirectory = ""
                PublicOutput.Actions.Clear()
                session.Fields["wall_seconds"] = timer.Elapsed.TotalSeconds
                session.Write(sessionPath)
                Report(session.Element())
            }
            return consecutive == 3 ? 1: 0
        }
    }
}
