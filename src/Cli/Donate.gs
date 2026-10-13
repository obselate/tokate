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

        private func Marker() string -> Path.Combine(LocalPaths.StateDirectory(), "donate.stop")

        internal func Stop() int32 {
            Directory.CreateDirectory(LocalPaths.StateDirectory())
            File.WriteAllText(Marker(), "stop\n")
            PublicOutput.ResultData = map[string, Object?]{"stop_requested": true}
            Terminal.Message("Donation will stop after the current task.")
            return 0
        }

        private func Pick(repo string, viewer JsonElement, attempted HashSet[int32]) int32 {
            var page int32 = 1
            while true {
                let issues = GitHub.Api(
                    "repos/" +
                        repo +
                        "/issues?state=open&labels=tokate%3Aapproved&sort=created&direction=asc&per_page=100&page=" +
                        page.ToString()
                )
                if issues.ValueKind != JsonValueKind.Array {
                    throw CliFailure("invalid_state", "Cannot list approved issues")
                }
                for issue in J.Items(issues) {
                    if J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                        continue
                    }
                    let number = J.Number(issue, "number")
                    if attempted.Contains(number) {
                        continue
                    }
                    try {
                        let state = CoordinationState.Load(repo, number)
                        ContributionPreparation.Available(repo, number, viewer, state)
                        if J.Get(state.Value(), "contribution").ValueKind != JsonValueKind.Object {
                            return number
                        }
                    } catch (error CliFailure) when error.Code == "stale_approval" || error.Code == "invalid_state" { }
                }
                if issues.GetArrayLength() < 100 {
                    return 0
                }
                page++
            }
        }

        private func Task(options Args, issue int32) Dictionary[string, Object?] {
            let claim = Args([]string{"claim"})
            for field in options.Values {
                if field.Key != "--total" && field.Key != "--profile" {
                    claim.Values[field.Key] = field.Value
                }
            }
            claim.Values["--issue"] = issue.ToString()
            var directory string = ""
            var result string = "submitted"
            var release string = ""
            var url string = ""
            try {
                directory = ContributionPreparation.Acquire(claim)
                let pending = Stopwatch.StartNew()
                while Data.Load(directory).Text("state") == "claim_pending" {
                    ApiTransport.BeginDeadline(
                        Math.Max(
                            0,
                            options.Number("seconds") - Convert.ToInt32(Math.Ceiling(pending.Elapsed.TotalSeconds))
                        )
                    )
                    ApiTransport.CheckDeadline()
                    Submission.ResetWorkflow()
                    if let guidance = Submission.PendingWorkflow(directory, Data.Load(directory)) {
                        if guidance["role"]?.ToString() == "owner" {
                            throw CliFailure(
                                "command_failed",
                                guidance["action"]?.ToString() ?? "Claim workflow failed"
                            )
                        }
                    }
                    ApiTransport.PollWait()
                    ContributionPreparation.ResumePending(
                        directory,
                        claim,
                        Math.Max(
                            0,
                            options.Number("seconds") - Convert.ToInt32(Math.Ceiling(pending.Elapsed.TotalSeconds))
                        )
                    )
                    if pending.Elapsed.TotalSeconds >= options.Number("seconds") {
                        throw ApiDeadlineException()
                    }
                }
                ApiTransport.EndDeadline()
                Dispatch(Args([]string{"work", "--run", directory, "--yes", "--non-interactive"}))
                let submit = Args([]string{"submit", "--run", directory})
                ApiTransport.BeginDeadline(options.Number("seconds"))
                while true {
                    ApiTransport.CheckDeadline()
                    Submission.Submit(submit)
                    let run = Data.Load(directory)
                    url = run.Text("pr_url")
                    if run.Number("pr") > 0 {
                        break
                    }
                    Submission.ResetWorkflow()
                    if let guidance = Submission.PendingWorkflow(directory, run) {
                        if guidance["role"]?.ToString() == "owner" {
                            throw CliFailure(
                                "command_failed",
                                guidance["action"]?.ToString() ?? "Submission workflow failed"
                            )
                        }
                    }
                    Terminal.Message("Submit pending. Checking the same submission again.")
                    ApiTransport.PollWait()
                }
            } catch (error CommandInterrupted) {
                throw error
            } catch (error Exception) {
                if directory == "" {
                    directory = PublicOutput.RunDirectory
                }
                result = error is CliFailure &&
                    (error.Code == "invalid_state" || error.Code == "stale_approval") &&
                    (directory == "" || Data.Load(directory).Text("id") == "") ? "skipped": "failed"
                Terminal.Message("Task #" + issue.ToString() + " " + result + ": " + error.Message, error: true)
                if directory != "" && Data.Load(directory).Text("id") != "" {
                    ApiTransport.BeginDeadline(30)
                    try {
                        let args = Args([]string{"release", "--run", directory})
                        while ReservationRequest.Run(args) == 8 {
                            ApiTransport.PollWait()
                        }
                        release = "released"
                    } catch (error CommandInterrupted) {
                        throw error
                    } catch (error Exception) {
                        release = "unconfirmed"
                        Terminal.Message(
                            "Reservation release unconfirmed: " + directory + ": " + error.Message,
                            error: true
                        )
                    } finally {
                        ApiTransport.EndDeadline()
                    }
                }
            } finally {
                ApiTransport.EndDeadline()
            }
            return map[string, Object?]{
                "issue": issue,
                "result": result,
                "pr_url": url,
                "run_directory": directory,
                "release": release
            }
        }

        internal func Run(options Args) int32 {
            if File.Exists(Marker()) {
                File.Delete(Marker())
            }
            let repo = options.Need("repo")
            let seconds = options.Number("seconds")
            let total = options.Get("total") == "" ? Double.PositiveInfinity: Convert.ToDouble(options.Number("total"))
            let info = GitHub.Api("repos/" + repo)
            let policy = Policy.Load(repo, GitHub.Branch(repo, J.Text(info, "default_branch")))
            policy.ValidateBudget(seconds, false)
            let selection = DonorSelection.Resolve(options, policy)
            let consent = repo + "\nHarness: " + J.Text(selection, "harness") + "\nModel: " + J.Text(
                selection,
                "model"
            ) +
                "\nEffort: " +
                J.Text(selection, "effort") + "\nPer task: " + seconds.ToString() +
                " seconds\nTotal: " +
                (Double.IsPositiveInfinity(total) ? "until stopped": total.ToString() + " seconds")
            if options.Get("yes") != "true" {
                if WizardScreen.Choose(
                    "Confirm repository donation",
                    consent,
                    []string{"Start", "Cancel"},
                    "This consent covers every task claimed in this repository with this tool and these limits.",
                    selected: 2
                ) != 1 {
                    throw CliFailure("confirmation_required", "Repository donation was not confirmed")
                }
            }
            WizardScreen.Close()
            Terminal.Message(consent, error: true)
            Active = true
            for key in[]string{"harness", "provider", "model", "effort"} {
                options.Values["--" + key] = J.Text(selection, key)
            }
            options.Values["--yes"] = "true"
            options.Values["--non-interactive"] = "true"
            let viewer = GitHub.Api("user")
            let timer = Stopwatch.StartNew()
            let tasks = List[Object]()
            let failed = List[string]()
            let attempted = HashSet[int32]()
            var completed int32
            var failures int32
            var consecutive int32
            var reason string = "stopped"
            try {
                while !File.Exists(Marker()) {
                    if seconds > total - timer.Elapsed.TotalSeconds {
                        reason = "total_exhausted"
                        break
                    }
                    PublicOutput.RunDirectory = ""
                    PublicOutput.Actions.Clear()
                    let issue = Pick(repo, viewer, attempted)
                    if File.Exists(Marker()) {
                        break
                    }
                    if seconds > total - timer.Elapsed.TotalSeconds {
                        reason = "total_exhausted"
                        break
                    }
                    if issue == 0 {
                        Terminal.Message("No eligible issues. Checking again in 10 minutes.")
                        let next = timer.Elapsed.TotalSeconds + 600
                        while !File.Exists(Marker()) &&
                            timer
                            .Elapsed
                            .TotalSeconds < next &&
                            seconds <= total - timer
                            .Elapsed
                            .TotalSeconds {
                            Thread.Sleep(1000)
                        }
                        continue
                    }
                    attempted.Add(issue)
                    let task = Task(options, issue)
                    tasks.Add(task)
                    if tasks.Count > 100 {
                        tasks.RemoveAt(0)
                        PublicOutput.Truncated = true
                    }
                    if task["result"]?.ToString() == "submitted" {
                        completed++
                        failed.Clear()
                        consecutive = 0
                    } else if task["result"]?.ToString() == "failed" {
                        failures++
                        consecutive++
                        let directory = task["run_directory"]?.ToString() ?? ""
                        if directory != "" {
                            failed.Add(directory)
                        }
                    }
                    if !PublicOutput.Enabled {
                        Console.WriteLine(
                            "#" + issue.ToString() + " " + task["result"]?.ToString() + " " + task["pr_url"]?.ToString()
                        )
                    }
                    if consecutive == 3 {
                        reason = "consecutive_failures"
                        Terminal.Message(
                            "Stopped after 3 consecutive failures. Failed runs: " + String.Join(", ", failed),
                            error: true
                        )
                        break
                    }
                }
            } finally {
                Active = false
                if File.Exists(Marker()) {
                    File.Delete(Marker())
                }
                PublicOutput.RunDirectory = ""
                PublicOutput.Actions.Clear()
                PublicOutput.ResultData = map[string, Object?]{
                    "repo": repo,
                    "reason": reason,
                    "completed": completed,
                    "failed": failures,
                    "failed_runs": failed,
                    "tasks": tasks
                }
            }
            return reason == "consecutive_failures" ? 1: 0
        }
    }
}
