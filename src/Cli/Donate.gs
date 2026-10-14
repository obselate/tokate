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
            if options.Get("yes") != "true" {
                if WizardScreen.Choose("Stop donating?", repo, []string{"Stop", "Cancel"}, selected: 2) != 1 {
                    throw CliFailure("confirmation_required", "Donation stop was not confirmed")
                }
            }
            WizardScreen.Close()
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

        private func Pick(repo string, attempted HashSet[int32]) int32 {
            var page int32 = 1
            while true {
                let query = "/issues?state=open&labels=tokate%3Aapproved&sort=created&direction=asc&per_page=100&page="
                let issues = GitHub.Api("repos/" + repo + query + page.ToString())
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

        private func Task(options Args, issue int32) Dictionary[string, Object?] {
            options.Values["--issue"] = issue.ToString()
            var directory string = ""
            let task = map[string, Object?]{"issue": issue, "result": "submitted"}
            try {
                directory = ContributionPreparation.Acquire(options)
                Dispatch(Args([]string{"work", "--run", directory, "--yes", "--non-interactive"}))
                Dispatch(Args([]string{"submit", "--run", directory}))
            } catch (error Exception) when !(error is CommandInterrupted) {
                directory = PublicOutput.RunDirectory
                let unclaimed = directory == "" || Data.Load(directory).Text("id") == ""
                let ineligible = error is CliFailure &&
                    (error.Code == "invalid_state" || error.Code == "stale_approval")
                task["result"] = unclaimed && ineligible ? "skipped": "failed"
                if !unclaimed {
                    ApiTransport.BeginDeadline(30)
                    try {
                        while ReservationRequest.Run(Args([]string{"release", "--run", directory})) == 8 {
                            ApiTransport.PollWait()
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

        private func GratisTask(
            options Args,
            revision string,
            guidance JsonElement,
            prompt string,
            snapshot JsonElement,
            issue JsonElement,
            policy Policy,
            selection JsonElement
        ) Dictionary[string, Object?] {
            var directory = ""
            let task = map[string, Object?]{"issue": J.Number(issue, "number"), "result": "failed"}
            try {
                directory = Gratis.Prepare(options, revision, guidance, prompt, snapshot, issue, policy, selection)
                Worker.Execute(directory, Args([]string{"work", "--run", directory, "--yes", "--non-interactive"}))
                task["result"] = GratisPublication.Submit(directory)
            } catch (error Exception) when !(error is CommandInterrupted) {
                directory = PublicOutput.RunDirectory
                task["error"] = error.Message
                Terminal.Message("Gratis task failed: " + error.Message, error: true)
            }
            task["pr_url"] = directory == "" ? "": Data.Load(directory).Text("pr_url")
            task["discussion_url"] = directory == "" ? "": Data.Load(directory).Text("discussion_url")
            task["run_directory"] = directory
            return task
        }

        internal func Run(options Args) int32 {
            let repo = options.Need("repo")
            let directory = Path.Combine(LocalPaths.StateDirectory(), "donations", repo.ToLowerInvariant())
            Directory.CreateDirectory(directory)
            using let lease = RunStorage.Lease(directory)
            let marker = Path.Combine(directory, "stop")
            File.Delete(marker)
            let total = options.Get("total") == "" ? Double.PositiveInfinity: Convert.ToDouble(options.Number("total"))
            let info = GitHub.Api("repos/" + repo)
            let branch = J.Text(info, "default_branch")
            var revision = GitHub.Branch(repo, branch)
            let policyFile = GitHub.Api(
                "repos/" + repo + "/contents/.github/tokate.json?ref=" + revision,
                missing: true
            )
            let gratis = policyFile.ValueKind == JsonValueKind.Undefined
            let policyText = gratis ? "": GitHub.FileAt(repo, ".github/tokate.json", revision)
            if !gratis && options.Get("prompt") != "" {
                throw CliFailure("invalid_arguments", "--prompt applies only to repositories without a Tokate policy")
            }
            let guidance = gratis ? GratisGuidance.Discover(repo, revision): JsonElement{}
            let prompt = gratis ? GratisGuidance.Prompt(options.Get("prompt")): ""
            let policy = gratis ? Gratis.PolicyFor(options, guidance): Policy(policyText)
            let maximum = Math.Min(3600, J.Number(policy.Value, "max_seconds"))
            let seconds = options.Get("seconds") == "" ? maximum: options.Number("seconds")
            options.Values["--seconds"] = seconds.ToString()
            policy.ValidateBudget(seconds, false)
            let selection = DonorSelection.Resolve(options, policy)
            let limit = Double.IsPositiveInfinity(total) ? "until stopped": total.ToString() + " seconds"
            let consent = repo + "\nHarness: " + J.Text(selection, "harness") + "\nModel: " + J.Text(
                selection,
                "model"
            ) +
                "\nEffort: " +
                J.Text(selection, "effort") + "\nPer task: " + seconds.ToString() +
                " seconds\nTotal: " +
                limit +
                (
                gratis ? GratisGuidance.Consent(guidance) + "\nTask instruction (SHA-256 " + Data.Hash(prompt) +
                    "):\n" +
                    prompt: ""
            )
            if options.Get("yes") != "true" {
                if WizardScreen.Choose(repo, consent, []string{"Start", "Cancel"}, selected: 2) != 1 {
                    throw CliFailure("confirmation_required", "Donation start was not confirmed")
                }
            }
            WizardScreen.Close()
            Terminal.Message(consent, error: true)
            options.Values["--yes"] = "true"
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
                    "mode": gratis ? "gratis": "coordinated",
                    "prompt_sha256": gratis ? Data.Hash(prompt): "",
                    "guidance": gratis ? J.Get(guidance, "files"): []Object{},
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
                    if gratis && J.Text(guidance, "blocked") != "" {
                        session.Fields["reason"] = "guidance_forbids_work"
                        session.Fields["message"] = J.Text(guidance, "blocked")
                        Terminal.Message(J.Text(guidance, "blocked"))
                        break
                    }
                    var snapshot = JsonElement{}
                    var selectedIssue = JsonElement{}
                    var issue int32
                    if gratis {
                        revision = GitHub.Branch(repo, branch)
                        if GitHub.Api("repos/" + repo + "/contents/.github/tokate.json?ref=" + revision, missing: true)
                            .ValueKind != JsonValueKind.Undefined ||
                            !RequestData
                            .Same(GratisGuidance.Discover(repo, revision), guidance) {
                            session.Fields["reason"] = "guidance_changed"
                            Terminal.Message(
                                "Repository guidance or policy changed. Start a new donation to confirm it."
                            )
                            break
                        }
                        snapshot = Gratis.Snapshot(repo)
                        if J.Count(J.Get(guidance, "files")) == 0 {
                            selectedIssue = Gratis.Pick(repo, attempted, snapshot)
                            if selectedIssue.ValueKind == JsonValueKind.Undefined {
                                session.Fields["reason"] = "no_eligible_issues"
                                Terminal.Message(
                                    "No eligible issue: open issues must be unassigned, unlocked and have no linked open PR."
                                )
                                break
                            }
                        }
                        issue = J.Number(selectedIssue, "number")
                    } else {
                        issue = Pick(repo, attempted)
                    }
                    if File.Exists(marker) || seconds > total - timer.Elapsed.TotalSeconds {
                        continue
                    }
                    if issue == 0 && !gratis {
                        Terminal.Message("No eligible issues. Checking again in 10 minutes.")
                        let next = Math.Min(timer.Elapsed.TotalSeconds + 600, total - seconds)
                        while !File.Exists(marker) && timer.Elapsed.TotalSeconds < next {
                            Thread.Sleep(1000)
                        }
                        continue
                    }
                    attempted.Add(issue)
                    let task = gratis ? GratisTask(
                        options,
                        revision,
                        guidance,
                        prompt,
                        snapshot,
                        selectedIssue,
                        policy,
                        selection
                    ): Task(options, issue)
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
                    if gratis && issue == 0 && result == "failed" {
                        session.Fields["reason"] = "task_failed"
                        break
                    }
                    if gratis && result == "skipped" {
                        session.Fields["reason"] = "no_uncovered_task"
                        Terminal.Message("No code change or findings returned. Gratis donation stopped.")
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
            return consecutive == 3 || session.Text("reason") == "task_failed" ? 1: 0
        }
    }
}
