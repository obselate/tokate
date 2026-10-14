package Tokate

import System
import System.IO
import System.Text.Json

func Main(args[]string) int32 {
    Terminal.Initialize()

    for argument in args {
        PublicOutput.Enabled = PublicOutput.Enabled || argument == "--json" || argument.StartsWith("--json=")
        Terminal.Plain = Terminal.Plain || argument == "--plain" || argument.StartsWith("--plain=")
        Terminal.Ascii = Terminal.Ascii || argument == "--ascii"
    }

    PublicOutput.Command = Cli.Name(args)

    var traffic bool
    var validated bool
    var options Args? = nil
    var code string = ""
    var message string = ""
    var exitCode int32

    try {
        options = Args(args)
        traffic = options.Get("traffic") == "true"
        Cli.Validate(options)
        validated = true
        PublicOutput.Command = options.Command

        if options.Get("run") != "" {
            PublicOutput.RunDirectory = Path.GetFullPath(options.Need("run"))
            PublicOutput.RunName = options.Run
            PublicOutput.FailureCode = "invalid_state"
        }

        PublicOutput.ResultData = map[string, Object?]{
            "repo": options.Get("repo"),
            "issue": options.Get("issue"),
            "donor": options.Get("donor"),
            "pr": options.Get("pr")
        }

        exitCode = Dispatch(options)

        if exitCode == 1 {
            code = options.Command == "doctor" ? "missing_tools": (
                options.Command == "checks" ? "verification_failed": "command_failed"
            )
        }
    } catch (error Exception) {
        DonationView.Close()
        exitCode = 1
        code = !validated ? "invalid_arguments": PublicOutput.FailureCode

        if error is CliFailure failure {
            code = failure.Code
            message = failure.Summary

            if failure.Action.Length > 0 {
                PublicOutput.Actions.Add(failure.Action)
            }
        } else {
            message = !validated ? error.Message: PublicOutput.Message(code)
        }

        if error is CliFailure invalidation &&
            invalidation.AttemptInvalidated &&
            PublicOutput.Command == "work" &&
            PublicOutput.RunDirectory != "" {
            try {
                using let lease = RunStorage.Lease(PublicOutput.RunDirectory)
                let run = Data.Load(PublicOutput.RunDirectory)
                if run.Text("state") == "claimed" && run.Text("source") == "tokate" {
                    run.Fields["state"] = "failed"
                    run.Fields["failure_stage"] = "preflight"
                    run.Fields["failure_reason"] = code
                    run.Save(PublicOutput.RunDirectory)
                }
            } catch (error Exception) { }
        }

        PublicOutput.Truncated = PublicOutput.Truncated || code == "output_too_large"
        let recovery = validated && PublicOutput.Command == "coordinate" ?
        " To recover a failed GitHub mutation: " + ApiTransport.MutationRecovery: ""
        message += recovery
        Terminal.Message("tokate: " + (PublicOutput.Enabled ? message: error.Message + recovery), "red", true)
        if Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true" &&
            (PublicOutput.Command == "coordinate" || PublicOutput.Command == "admit") {
            Console.Error.WriteLine(
                "::error::" + (PublicOutput.Enabled ? message: error.Message + recovery).Replace("\r", "").Replace(
                    "\n",
                    ""
                )
            )
        }

        if !validated && !PublicOutput.Enabled {
            Terminal.Message(Cli.ErrorUsage(args), error: true)
        }

        if let failed = options {
            if code == "invalid_state" && failed.Attempts.Count > 1 && !PublicOutput.Enabled {
                Terminal.Runs(failed, RunReference.Recent(failed.Attempts), true)
            }
        }
    } finally {
        DonationView.Close()
        if traffic {
            ApiTransport.Report()
        }
    }

    if PublicOutput.Enabled || (PublicOutput.RunDirectory != "" && Terminal.Foreground()) {
        if let named = options {
            if !PublicOutput.Enabled && PublicOutput.RunName == "" {
                PublicOutput.RunName = RunReference.Name(named, PublicOutput.RunDirectory)
            }
        }

        PublicOutput.Next(options, code)

        if options?.Help != true {
            Terminal.RunOutcome(exitCode, code)
        }
    }

    if PublicOutput.Enabled {
        return PublicOutput.Emit(exitCode, code, message)
    }

    return exitCode
}

func Dispatch(options Args) int32 {
    if options.Help {
        if PublicOutput.Enabled {
            PublicOutput.ResultData = Cli.Metadata(options.Command == "help" ? options.Subject: options.Command)
        } else {
            Terminal.Help(options.Command == "help" ? options.Subject: options.Command)
        }

        return 0
    }

    if options.Command == "completion" {
        let script = Completion.Script(options.Subject)

        if PublicOutput.Enabled {
            PublicOutput.ResultData = map[string, Object?]{"shell": options.Subject, "script": script}
        } else {
            Console.Write(script)
        }

        return 0
    }

    if !OperatingSystem.IsLinux() {
        throw Exception("This release supports Linux")
    }

    if options.Command == "--version" {
        if PublicOutput.Enabled {
            PublicOutput.ResultData = map[string, Object?]{"version": ApplicationInfo.Version()}
        } else {
            Console.WriteLine("tokate " + ApplicationInfo.Version())
        }

        return 0
    }

    if options.Command == "runs" {
        RunReference.Print(options)

        return 0
    }

    if options.Command == "update" || options.Command == "uninstall" {
        PublicOutput.ResultData = map[string, Object?]{
            "version": ApplicationInfo.Version(),
            "installation": options.Command
        }

        return Installation.Run(options.Command)
    }

    if options.Command == "claude-capabilities" {
        var value System.Text.Json.JsonElement

        try {
            value = ClaudeCode.Gate(options)
        } catch (error Exception) {
            throw CliFailure("verification_failed", error.Message, summary: error.Message)
        }

        if PublicOutput.Enabled {
            PublicOutput.ResultData = value
        } else {
            Terminal.Json(value, "Claude capabilities; no inference started")
        }

        return 0
    }

    if Cli.RepositoryWork(options) && options.Subject == "stop" {
        return Donate.Stop(options)
    }

    if options.Command != "doctor" && options.Command != "defaults" {
        DonorSelection.ApplyDefaults(options)
        Startup.Check(options)
    }

    if options.Command == "claim" ||
        options.Command == "work" ||
        options.Command == "submit" ||
        options.Command == "status" {
        OwnerHealth.WarnCoordinator(options)
    }

    switch options.Command {
        case "doctor" {
            return Startup.Doctor(options)
        }

        case "defaults" {
            let value = DonorDefaults.Run(options)

            if PublicOutput.Enabled {
                PublicOutput.ResultData = value
            } else {
                Terminal.Json(value, "Donor defaults")
            }
        }

        case "select" {
            let repo = RepositoryIdentity.Repo(options.Need("repo"))
            let info = GitHub.Api("repos/" + repo)
            let selection = DonorSelection.Resolve(options, Policy.Load(repo, J.Text(info, "default_branch")))

            if PublicOutput.Enabled {
                PublicOutput.ResultData = J.Select(
                    selection,
                    "harness,provider,model,effort,source,policy_hash,policy_eligible,capability,availability,availability_evidence"
                )
            } else {
                Terminal.Json(selection, "Donor selection")
            }
        }

        case "init" {
            OwnerSetup.Run(options)
        }

        case "coordinator-setup" {
            PublicOutput.ResultData = map[string, Object?]{
                "repo": options.Get("repo"),
                "output": Path.GetFullPath(options.Need("output"))
            }
            CoordinatorSetup.Run(options)
        }

        case "access" {
            AccessState.Run(options)
        }

        case "coordinate" {
            Coordinator.Run(options)
        }

        case "recover-request" {
            Coordinator.RecoverRequest(options)
        }

        case "admit" {
            Admission.Run(options)
        }

        case "coordination" {
            let state = CoordinationState.Load(RepositoryIdentity.Repo(options.Need("repo")), options.Number("issue"))

            if PublicOutput.Enabled {
                PublicOutput.ResultData = PublicOutput.Coordination(state.Value(), state.Sha)
            } else {
                Terminal.Json(
                    J.Parse(J.Write(map[string, Object?]{"sha": state.Sha, "state": state.Value()})),
                    "Contribution coordination"
                )
            }
        }

        case "request" {
            Submission.Request(options)
        }

        case "pause" {
            return ReservationRequest.Run(options)
        }

        case "resume" {
            return ReservationRequest.Run(options)
        }

        case "renew" {
            return ReservationRequest.Run(options)
        }

        case "release" {
            return ReservationRequest.Run(options)
        }

        case "external" {
            ExternalContribution.External(options)
        }

        case "reconcile" {
            Reconciliation.Run(options)

            return 0
        }

        case "sync" when options.Subject == "authorize" {
            Synchronization.Authorize(options)
        }

        case "sync" {
            Synchronization.Revoke(options)
        }

        case "amend" {
            Amendment.Run(options)
        }

        case "submit" {
            Submission.Submit(options)

            if !PublicOutput.Enabled || Donate.Active {
                let directory = Path.GetFullPath(options.Need("run"))
                var run = Data.Load(directory)
                let request = run.Number("pr") == 0 ? RequestData.FileData(
                    Path.Combine(directory, "request.json"),
                    8192
                ):
                JsonElement{}
                ApiTransport.BeginDeadline(Donate.Active ? run.Number("seconds"): 30)
                try {
                    while run.Number("pr") == 0 {
                        if let guidance = Submission.PendingWorkflow(directory, run) {
                            if Donate.Active && guidance["role"]?.ToString() == "owner" {
                                throw CliFailure("command_failed", "Owner workflow failed")
                            }
                            if !Donate.Active {
                                Terminal.Message(guidance["action"]?.ToString() ?? "")
                                return 0
                            }
                        }
                        let state = CoordinationState.Load(run.Text("repo"), run.Number("issue"))
                        if RequestData.Recorded(state.Value(), J.Get(run.Element(), "donor_id"), request)
                            .ValueKind == JsonValueKind.Undefined {
                            ApiTransport.PollWait()
                        }
                        Submission.ResetWorkflow()
                        Submission.Submit(options)
                        run = Data.Load(directory)
                    }
                } catch (error ApiDeadlineException) when !Donate.Active {
                    Terminal.Message("Submit pending. Run the same command again: tokate submit --run " + directory)
                    return 0
                } finally {
                    ApiTransport.EndDeadline()
                }
            }
        }

        case "approve" {
            OwnerApproval.Approve(options)
        }

        case "revoke" {
            OwnerApproval.Revoke(options)
        }

        case "claim", "work" {
            if Cli.RepositoryWork(options) {
                return Donate.Run(options)
            }
            let directory = options.Get("run") == "" ? ContributionPreparation.Acquire(options):
            ContributionPreparation.Resume(Path.GetFullPath(options.Need("run")), options)
            let ready = Data.Load(directory)

            if ready.Text("state") == "claim_pending" {
                return 8
            }

            if options.Command == "work" && ready.Text("source") == "tokate" {
                if options.Get("run") != "" && !ready.Flag("gratis") {
                    Overlaps.RequireDependencies(ready.Text("repo"), ready.Number("issue"))
                }
                HarnessRunner.Execute(directory, options)
                PublicOutput.FailureCode = "command_failed"
                if !ready.Flag("gratis") || Data.Load(directory).Text("state") == "generated" {
                    Submission.Commit(directory)
                }
            }
        }

        case "overlaps" {
            Overlaps.Run(options)
        }

        case "checks" {
            return Checks.Run(options)
        }

        case "policy" {
            let repo = RepositoryIdentity.Repo(options.Need("repo"))
            let info = GitHub.Api("repos/" + repo)
            let value = Policy.Load(repo, J.Text(info, "default_branch")).Value

            if PublicOutput.Enabled {
                PublicOutput.ResultData = map[string, Object?]{"repo": repo, "policy": PublicOutput.Policy(value)}
            } else {
                Terminal.Json(value, "Repository policy")
            }
        }

        case "verify" {
            let repo = RepositoryIdentity.Repo(options.Need("repo"))
            let number = options.Number("pr")
            let pull = GitHub.Api("repos/" + repo + "/pulls/" + number.ToString(), missing: true)

            if pull.ValueKind == JsonValueKind.Undefined {
                throw Exception("verify takes an open contribution PR, for example tokate verify 42.")
            }

            if J.Text(pull, "state") != "open" {
                let state = J.Bool(pull, "merged") ? "merged": "closed"
                throw Exception("PR #" + number.ToString() + " is " + state + "; verify checks open contribution PRs.")
            }

            let run = ReceiptVerification.Verify(repo, number, pull)

            PublicOutput.ResultData = J.Select(run.Element(), "repo,pr,pr_url,commit")
            Terminal.Message("PR receipt matches owner approval and policy. Model usage remains donor-reported.")
        }

        case "status" when options.Get("run") == "" {
            ContributionStatus.Run(options)
        }

        case "status" when !PublicOutput.Enabled {
            let summary = PublicOutput.RunSummary(Path.GetFullPath(options.Need("run")))

            summary["truncated"] = PublicOutput.Truncated
            PublicOutput.Next(options, "")
            Terminal.SavedRun(J.Parse(J.Write(summary)))
        }
    }

    if PublicOutput.Enabled && PublicOutput.RunDirectory != "" {
        PublicOutput.ResultData = PublicOutput.RunSummary(PublicOutput.RunDirectory)
    }

    return 0
}
