package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

private func Initialize(args[]string) {
    Output.Sink = CliOutput()
    Args.Parse = Cli.Parse
    ApiTransport.Run = async (arguments, input, milliseconds) -> {
        let result = Commands.Run("gh", arguments, input: input, github: true, milliseconds: milliseconds)
        return ApiCommandResult{
            Code: result.Code,
            Output: result.Output,
            Truncated: result.Truncated,
            ReadFailed: result.ReadFailed
        }
    }
    Terminal.Initialize()

    for argument in args {
        PublicOutput.Enabled = PublicOutput.Enabled || argument == "--json" || argument.StartsWith("--json=")
        Terminal.Plain = Terminal.Plain || argument == "--plain" || argument.StartsWith("--plain=")
        Terminal.Ascii = Terminal.Ascii || argument == "--ascii"
    }
}

func Main(args[]string) int32 {
    Initialize(args)

    PublicOutput.Command = Cli.Name(args)

    var traffic bool
    var validated bool
    var options Args? = nil
    var code string = ""
    var message string = ""
    var exitCode int32

    let stdout = Console.Out
    if PublicOutput.Enabled {
        Console.SetOut(Console.Error)
    }

    try {
        options = Args(args)
        traffic = options.Get("traffic") == "true"
        Cli.Validate(options)
        validated = true
        PublicOutput.Command = options.Command

        if options.Get("run") != "" {
            PublicOutput.RunDirectory = Path.GetFullPath(options.Need("run"))
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
            message = !validated ? error.Message: CliFailure.Message(code)
        }

        if error is CliFailure invalidation &&
            invalidation.AttemptInvalidated &&
            PublicOutput.Command == "work" &&
            PublicOutput.RunDirectory != "" {
            try {
                using let lease = RunStorage.Lease(PublicOutput.RunDirectory)
                let run = Data.Load(PublicOutput.RunDirectory)
                if run.State == "claimed" && run.Source == "tokate" {
                    run.Transition("failed")
                    run.FailureStage = "preflight"
                    run.FailureReason = code
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
    } finally {
        DonationView.Close()
        if traffic {
            Console.Error.WriteLine("Tokate API traffic: " + J.Write(ApiTransport.Report()))
            Console.Error.WriteLine(
                "Counts measure Tokate gh-api operations; exclude unseen GitHub CLI/Git requests and workflow executions."
            )
        }
    }
    if PublicOutput.Enabled || (PublicOutput.RunDirectory != "" && Terminal.Foreground()) {
        PublicOutput.Next(options, code)

        if options?.Help != true {
            Terminal.RunOutcome(exitCode, code)
        }
    }

    Console.SetOut(stdout)
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

    if options.Command == "status" && options.Get("repo") == "" && options.Get("run") == "" {
        RunReference.Print(options)

        return 0
    }

    if options.Command == "clean" {
        return CleanCommand.Run(options)
    }

    if options.Command == "update" || options.Command == "uninstall" {
        return Installation.Run(options)
    }

    if Cli.RepositoryWork(options) && options.Subject == "stop" {
        return Donate.Stop(options)
    }

    ConfirmCommand(options)

    if options.Command == "work" && options.Get("feedback") == "true" {
        FeedbackRevision.Options(options)
        return WorkCommand(options) ?? 0
    }

    if (options.Command != "doctor" || options.Subject == "repo") &&
        (options.Command != "defaults" || options.Subject == "check") {
        DonorSelection.ApplyDefaults(options)
        Startup.Check(options)
    }

    if options.Command == "claim" ||
        options.Command == "work" ||
        options.Command == "submit" ||
        options.Command == "status" {
        OwnerHealth.WarnCoordinator(options)
    }

    return RunCommand(options)
}

private func PreviewCommand(options Args, change string, saved Data? = nil) {
    let directory = options.Get("run")
    let data = map[string, Object?]{
        "operation": options.Command,
        "subject": options.Subject,
        "repo": options.Get("repo"),
        "issue": options.Get("issue"),
        "donor": options.Get("donor"),
        "base_branch": options.Get("base-branch"),
        "changes": []string{change},
        "run_directory": directory,
        "applied": false
    }
    var target = options.Get("repo") + "#" + options.Get("issue")

    if directory != "" {
        let path = Path.GetFullPath(directory)
        let run = saved ?? Data.Load(path)
        let row = SavedRuns([]string{Path.GetDirectoryName(path) ?? ""}).Rows.Find(row -> row.Location == path)
        target = row?.Name ?? run.Repo + "#" + run.Issue.ToString()
        data["subject"] = target
        data["repo"] = run.Repo
        data["issue"] = run.Issue.ToString()
        data["donor"] = run.Donor
        data["base_branch"] = run.BaseBranch
    } else if options.Subject != "" {
        target += " (" + options.Subject + ")"
    }

    PublicOutput.ResultData = data
    let donor = data["donor"]?.ToString() ?? ""
    Terminal.Message(change + ". Target: " + target + (donor == "" ? "": " Donor: " + donor) + ".", error: true)
}

private func ConfirmCommand(options Args) {
    let consent = options.Get("yes") != "true" &&
        (
        options.Command == "approve" ||
            options.Command == "revoke" ||
            (
            options.Command == "access" &&
                options.Subject != "list" &&
                options.Subject != "history" &&
                options.Subject != "check" &&
                options.Subject != ""
        ) ||
            options.Command == "claim" ||
            options.Command == "pause" ||
            options.Command == "resume" ||
            options.Command == "renew" ||
            options.Command == "release" ||
            options.Command == "request" ||
            (
            options.Command == "work" && options.Get("run") != "" && Data.Load(Path.GetFullPath(options.Need("run")))
                .Source == "external"
        ) ||
            options.Command == "amend" ||
            options.Command == "external" ||
            (options.Command == "checks" && options.Get("run") != "")
    )

    if consent {
        var change = Cli.Find(options.Command).Brief
        var question = "Apply these changes?"

        if options.Command == "approve" {
            let state = CoordinationState.Load(options.Need("repo"), options.Number("issue"), true)
            if state.Sha != "" {
                question = "Replace approval?"
            }
            let warning = state.ApprovalWarning(options.Need("repo"))
            if warning != "" {
                change += ". " + warning.TrimEnd('.')
            }
        }

        PreviewCommand(options, change)

        if !OwnerSetup.Confirm(options, question) {
            throw CliFailure("confirmation_required", "Pass --yes to apply the preview. Nothing changed.")
        }

        options.Values["--yes"] = "true"
    }
}

private func RunCommand(options Args) int32 {
    switch options.Command {
        case "doctor" {
            return Startup.Doctor(options)
        }

        case "defaults" {
            let value = DonorDefaults.Run(options)

            if PublicOutput.Enabled {
                PublicOutput.ResultData = value
            } else {
                Terminal.Heading("Donor defaults")
                Terminal.Fields(value)
            }
        }

        case "init" {
            OwnerSetup.Run(options)
        }

        case "access" {
            AccessState.Run(options)
            RenderAccess(options)
        }

        case "coordinate" {
            let outcome = Coordinator.Run(options)

            if outcome.Item1.ValueKind != JsonValueKind.Undefined {
                Terminal.Json(outcome.Item1, outcome.Item2)
            }
        }

        case "admit" {
            Admission.Run(options)
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

        case "amend" {
            Amendment.Run(options)
        }

        case "submit" {
            if let result = SubmitCommand(options) {
                return result
            }
        }

        case "approve" {
            OwnerApproval.Approve(options)
        }

        case "revoke" {
            OwnerApproval.Revoke(options)
        }

        case "claim", "work" {
            if let result = WorkCommand(options) {
                return result
            }
        }

        case "overlaps" {
            Overlaps.Run(options)

            RenderOverlaps()
        }

        case "checks" {
            return Checks.Run(options, RenderCheckDetails)
        }

        case "status" when options.Get("run") == "" {
            RunReference.Status(options)
        }

        case "status" {
            ContributionStatus.Attempt(options)

            if !PublicOutput.Enabled {
                RunReference.PrintStatus(J.Parse(J.Write(PublicOutput.ResultData)))
            }

            return 0
        }
    }

    if PublicOutput.Enabled && PublicOutput.RunDirectory != "" {
        PublicOutput.ResultData = PublicOutput.RunSummary(PublicOutput.RunDirectory)
    }

    return 0
}

private func RenderAccess(options Args) {
    if PublicOutput.Enabled || (options.Subject != "list" && options.Subject != "history") {
        return
    }

    let value = PublicOutput.ResultData as Dictionary[string, Object?] ?? throw Exception("Missing donor access result")

    if options.Subject == "history" {
        Terminal.Json(J.Parse(J.Write(value)), "Donor access and owner review")
        return
    }

    Terminal.Heading("Donor access")

    let trusted = value["trusted"] as List[JsonElement] ?? throw Exception("Missing trusted donors")

    for member in trusted {
        Terminal.Row("Trusted donor", J.Text(member, "donor"))
    }

    let members = value["members"] as List[JsonElement] ?? throw Exception("Missing donor access members")
    let pending = value["pending"] as List[JsonElement] ?? throw Exception("Missing donor access requests")

    for member in members {
        let login = J.Text(member, "donor")

        if J.Bool(member, "denied") {
            Terminal.Row("Denied donor", login)
        }
    }

    for request in pending {
        Terminal.Row(
            "Pending request",
            J.Text(request, "donor") + " #" + J.Number(request, "issue").ToString() + " (" + J.Text(request, "scope") +
                ")"
        )
    }

    if members.Count == 0 && pending.Count == 0 {
        Terminal.Message("No donor access or pending requests.", "default")
    }
}

private func SubmitSaved(args Args) {
    try {
        let directory = Path.GetFullPath(args.Need("run"))
        using let lease = RunStorage.Lease(directory)
        let run = Data.Load(directory)

        if FeedbackRevision.Pending(directory, run) {
            if !run.Gratis && args.Get("yes") != "true" {
                PreviewCommand(args, "Publish the saved feedback revision", run)
                if !OwnerSetup.Confirm(args) {
                    throw CliFailure(
                        "confirmation_required",
                        "Pass --yes to publish the saved revision. Nothing changed."
                    )
                }
            }
            if run.Gratis {
                FeedbackRevision.Publish(
                    directory,
                    run,
                    (preview, consent) -> Gratis.ConfirmPublish(directory, args, preview, consent)
                )
            } else {
                FeedbackRevision.Publish(directory, run)
            }
            return
        }

        if run.Gratis {
            Publication.PublishGratis(
                directory,
                run,
                (preview, consent) -> Gratis.ConfirmPublish(directory, args, preview, consent)
            )
            return
        }

        if args.Get("yes") != "true" {
            PreviewCommand(args, Cli.Find("submit").Brief, run)

            if !OwnerSetup.Confirm(args) {
                throw CliFailure("confirmation_required", "Pass --yes to apply the preview. Nothing changed.")
            }

            args.Values["--yes"] = "true"
        }

        Submission.Submit(args, directory, run)
    } catch (error Exception) when error is IOException ||
        error is UnauthorizedAccessException ||
        error is CommandInterrupted ||
        error.GetType() == typeof(Exception) && error.Message.StartsWith("git failed: ") {
        let code = (error is IOException || error is UnauthorizedAccessException) ? "invalid_state": "command_failed"
        throw CliFailure(code, error.Message, summary: CliFailure.Message(code))
    }
}

private func SubmitCommand(options Args) int32? {
    SubmitSaved(options)

    let directory = Path.GetFullPath(options.Need("run"))
    var run = Data.Load(directory)

    if FeedbackRevision.Pending(directory, run) {
        return run.Gratis ? 0: Output.PendingExitCode
    }

    if run.Gratis {
        return 0
    }

    if PublicOutput.Enabled && !Donate.Active {
        let pending = run.Pr == 0

        if pending {
            Submission.FailedWorkflow(directory, run)

            if PublicOutput.RunDirectory != "" {
                PublicOutput.ResultData = PublicOutput.RunSummary(PublicOutput.RunDirectory)
            }

            return Output.PendingExitCode
        }
    } else {
        let request = run.Pr == 0 ? RequestData.FileData(
            Path.Combine(directory, "request.json"),
            RequestData.RequestByteLimit
        ):
        JsonElement{}
        ApiTransport.BeginDeadline(Donate.Active ? run.Seconds: ApiTransport.DefaultDeadlineSeconds)
        try {
            while run.Pr == 0 {
                Submission.FailedWorkflow(directory, run)

                if let guidance = Submission.PendingWorkflow(directory, run) {
                    if !Donate.Active {
                        Terminal.Message(guidance["action"]?.ToString() ?? "")
                        return Output.PendingExitCode
                    }
                }

                let state = CoordinationState.Load(run.Repo, run.Issue)
                if RequestMetadata.Recorded(state, run.DonorId, request) == nil {
                    ApiTransport.PollWait("repos/" + run.Repo + "/actions/")
                    Submission.ResetWorkflow()
                } else {
                    SubmitSaved(options)
                    run = Data.Load(directory)
                }
            }
        } catch (error ApiDeadlineException) when !Donate.Active {
            return Output.PendingExitCode
        } finally {
            ApiTransport.EndDeadline()
        }
    }

    return nil
}

private func WorkCommand(options Args) int32? {
    if options.Get("feedback") == "true" {
        let directory = Path.GetFullPath(options.Need("run"))
        FeedbackRevision.Work(directory, options, async () -> Startup.Check(options))
        return FeedbackRevision.Pending(directory, Data.Load(directory)) && options.Get(
            "review"
        ) != "true" ? Output.PendingExitCode: 0
    }

    if Cli.RepositoryWork(options) ||
        (
        options.Command == "work" && options.Get("run") == "" &&
            (
            options.Get("review") == "true" || options.Get("prompt") != "" || options.Get("total") != "" || GitHub.Api(
                "repos/" + options.Need("repo") + "/contents/" + Policy.FilePath,
                missing: true
            )
                .ValueKind == JsonValueKind.Undefined
        )
    ) {
        return Donate.Run(options)
    }

    let directory = options.Get("run") == "" ? ContributionPreparation.Acquire(options):
    ContributionPreparation.Resume(Path.GetFullPath(options.Need("run")), options)
    let ready = Data.Load(directory)

    if ready.State == "claim_pending" {
        return Output.PendingExitCode
    }

    if options.Command == "work" && ready.Source == "tokate" {
        if options.Get("run") != "" && !ready.Gratis {
            Overlaps.RequireDependencies(ready.Repo, ready.Issue)
        }

        HarnessRunner.Execute(directory, options)
        PublicOutput.FailureCode = "command_failed"

        if !ready.Gratis || Data.Load(directory).State == "generated" {
            Submission.Commit(directory)
        }
    }

    return nil
}

private func RenderCheckDetails(facts Dictionary[string, Object?]) {
    Terminal.Checks(J.Get(J.Parse(J.Write(PublicOutput.ResultData ?? map[string, Object?]{})), "checks"))

    let evidence = Dictionary[string, Object?](facts)
    evidence.Remove("owner_inspection_required")

    Terminal.Json(J.Parse(J.Write(evidence)), "Check gates and required owner actions")
}

private func RenderOverlaps() {
    if !PublicOutput.Enabled {
        let result = PublicOutput.ResultData as Dictionary[string, Object?] ??
            throw Exception("Invalid overlaps result")
        result["truncated"] = PublicOutput.Truncated
        Terminal.Message(result["advisory"]?.ToString() ?? "", "cyan")
        Terminal.Json(J.Parse(J.Write(result)), "Selected contributions")
    }
}
