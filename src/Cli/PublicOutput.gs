package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class PublicOutput {
    shared {
        private const JsonOutputByteLimit int32 = 65536

        private const CommandCharacterLimit int32 = 2048

        internal var Enabled bool
        internal var Command string = "help"
        internal var RunDirectory string = ""
        internal var FailureCode string = "command_failed"
        internal var ResultData Object? = nil
        internal var Truncated bool
        internal let Actions List[[]string] = List[[]string]()

        internal func Reset(command string = "help") {
            Submission.ResetWorkflow()
            Command = command
            RunDirectory = ""
            FailureCode = "command_failed"
            ResultData = nil
            Truncated = false
            Actions.Clear()
        }

        internal func Tools(tools List[ToolCheck]) {
            let rows = List[Object]()

            for tool in tools {
                rows.Add(
                    map[string, Object?]{
                        "name": tool.Name,
                        "status": tool.Status,
                        "path": tool.Path,
                        "hint": tool.Hint,
                        "detail": tool.Detail,
                        "code": tool.Code
                    }
                )
            }

            ResultData = map[string, Object?]{"tools": rows, "tool_count": tools.Count, "inference": false}
        }

        private func Rows(value JsonElement, keys string, arguments bool = false) List[Object] {
            let rows = List[Object]()

            if value.ValueKind != JsonValueKind.Array {
                return rows
            }

            let count = value.GetArrayLength()

            if count > Output.RowCountLimit {
                Truncated = true
            }

            for i in 0 ... Math.Min(Output.RowCountLimit, count) {
                let item = value[i]
                let row = arguments ? map[string, Object?]{}: J.Select(item, keys)

                if arguments {
                    let check = Verification.Result.Parse(item)

                    if let state = check.State {
                        row["state"] = state
                    }

                    if let code = check.ExitCode {
                        row["exit_code"] = code
                    }

                    if let truncated = check.OutputTruncated {
                        row["output_truncated"] = truncated
                    }

                    if let truncated = check.ErrorTruncated {
                        row["error_truncated"] = truncated
                    }

                    row["command"] = check.Command
                }

                rows.Add(row)
            }

            return rows
        }

        private func KnownReason(reason string) bool -> Array.IndexOf(
            []string{
                "missing_tools",
                "namespace_disabled",
                "namespace_restricted",
                "namespace_unavailable",
                "authentication_required",
                "stale_approval",
                "invalid_state",
                "protected_path",
                "verification_failed",
                "inference_failed",
                "endpoint_unavailable",
                "command_failed"
            },
            reason
        ) >= 0

        internal func Policy(value JsonElement) Object {
            let policy = Tokate.Policy.Parse(value)
            let result = map[string, Object?]{
                "version": policy.Version,
                "max_seconds": policy.MaxSeconds,
                "allow_unlimited": policy.AllowUnlimited,
                "reservation_seconds": policy.ReservationSeconds,
                "approval_scope": policy.ApprovalScope,
                "eligibility": policy.Eligibility,
                "target_branch": policy.TargetBranch,
                "pr_text": policy.PrText,
                "close_message": policy.CloseMessage
            }
            for key in[]string{"allow_unlimited", "reservation_seconds", "target_branch", "pr_text"} {
                var field JsonElement
                if !value.TryGetProperty(key, out field) || field.ValueKind == JsonValueKind.Null {
                    result.Remove(key)
                }
            }

            for key in[]string{"verification", "required_checks", "protected_paths"} {
                let source = key == "verification" ? policy.Verification:
                key == "required_checks" ? policy.RequiredChecks: policy.ProtectedPaths
                let items = J.Items(source)
                let rows = List[Object]()

                for i in 0 ... Math.Min(Output.RowCountLimit, items.Count) {
                    rows.Add(items[i])
                }

                result[key] = rows
                result[key + "_count"] = items.Count
                Truncated = Truncated || items.Count > Output.RowCountLimit
            }

            let entries = policy.AllowedTools

            let retained = List[Object]()
            for i in 0 ... Math.Min(Output.RowCountLimit, entries.Count) {
                let tool = map[string, Object?]{"harness": entries[i].Harness, "provider": entries[i].Provider}
                if let models = entries[i].Models {
                    for field in PolicyModels(models) {
                        tool[field.Key] = field.Value
                    }
                }

                retained.Add(tool)
            }

            result["allowed_tools"] = retained
            result["allowed_tools_count"] = entries.Count
            Truncated = Truncated || entries.Count > Output.RowCountLimit

            return result
        }

        private func PolicyModels(source Dictionary[string, List[string]]) Dictionary[string, Object?] {
            let models = map[string, Object?]{}
            let effortCounts = map[string, Object?]{}
            var count int32

            for model in source {
                count++

                if count <= Output.RowCountLimit {
                    let efforts = model.Value
                    let retained = List[Object]()

                    for i in 0 ... Math.Min(Output.RowCountLimit, efforts.Count) {
                        retained.Add(efforts[i])
                    }

                    models[model.Key] = retained
                    effortCounts[model.Key] = efforts.Count
                    Truncated = Truncated || efforts.Count > Output.RowCountLimit
                }
            }

            Truncated = Truncated || count > Output.RowCountLimit
            let result = map[string, Object?]{"models": models}
            result["model_count"] = count
            result["model_effort_counts"] = effortCounts

            return result
        }

        internal func RunSummary(directory string) Dictionary[string, Object?] {
            let run = Data.Load(directory)

            if run.Version != Data.FormatVersion {
                throw CliFailure("invalid_state", "Unsupported saved run protocol")
            }

            let value = run.Element()
            let result = J.Select(
                value,
                "version,id,repo,issue,donor,donor_id,head_repo,approval,base,base_branch,policy_hash,model,requested_model,reported_model,effort,seconds,verification_reserve,unlimited,branch,state,state_sha,publication_uuid,source,commit,pr,pr_url,elapsed_seconds,codex_version,pi_version,claude_version,omp_version,output_truncated,error_truncated,preparation_version,preparation_complete,checkout_prepared,attempt,incomplete,partial_source_state,publication_attempt"
            )

            if run.Source == "tokate" {
                result["coding_seconds"] = run.Unlimited ? nil: run.Seconds - run.VerificationReserve
                result["verification_reserve"] = run.VerificationReserve
            }

            result["run"] = directory

            if run.State == "claim_pending" {
                result["next"] = map[string, Object?]{
                    "role": "donor",
                    "action": "Your claim is pending. Check the coordinator outcome with tokate work. If the Tokate workflow failed: " +
                        ApiTransport.MutationRecovery,
                    "command": []string{"tokate", "work", "--run", directory, "--json"}
                }
            }

            if ContributionHandoff.Has(run) {
                result["handoff"] = run.Handoff
            }

            result["storage"] = RunStorage.Summary(directory, run)

            let verification = run.Verification

            result["verification"] = Rows(verification, "state,exit_code,output_truncated,error_truncated", true)
            result["verification_count"] = J.Count(verification)

            if AttemptContinuation.Has(run) {
                result["predecessor"] = run.Continuation
                result["continuation_phase"] = run.ContinuationPhase
            }

            let usage = map[string, Object?]{}

            for key in[]string{"input_tokens", "cached_input_tokens", "output_tokens"} {
                let item = J.Get(run.Usage, key)
                var count int64

                if item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out count) && count >= 0 {
                    usage[key] = count
                }
            }

            if usage.Count > 0 {
                result["usage"] = usage
            }

            let tools = run.Tools

            if tools.ValueKind == JsonValueKind.Array {
                result["tools"] = Rows(tools, "harness,provider,model,effort,version")
                result["tool_count"] = J.Count(tools)
            }

            SummarizeChangesAndFailure(directory, run, result)

            result["artifacts"] = Artifacts(directory)

            if let guidance = Submission.PendingWorkflow(directory, run) {
                result["coordinator"] = guidance["action"]
                result["next"] = guidance
            }

            if Encoding.UTF8.GetByteCount(J.Write(result)) > JsonOutputByteLimit {
                throw CliFailure("output_too_large", CliFailure.Message("output_too_large"))
            }

            return result
        }

        private func SummarizeChangesAndFailure(directory string, run Data, result Dictionary[string, Object?]) {
            let amendments = run.Amendments

            if amendments.ValueKind == JsonValueKind.Array {
                result["amendments"] = Rows(amendments, "id,previous,head")
                result["amendment_count"] = J.Count(amendments)
            }

            let amendmentDirectory = Path.Combine(directory, "amendments")

            if Directory.Exists(amendmentDirectory) {
                for location in Directory.EnumerateDirectories(amendmentDirectory) {
                    if !File.Exists(Path.Combine(location, "run.json")) {
                        continue
                    }

                    let amendment = Data.Load(location, amendment: true)

                    if amendment.State != "requested" || amendment.Previous != run.Commit {
                        continue
                    }

                    result["amendment"] = ChangeSummary(amendment, location)

                    result["next"] = ChangeNext(directory, amendment)

                    break
                }
            }

            if run.Amendment != "" {
                let location = Path.Combine(directory, "amendments", run.Amendment)
                let correction = Data.Load(location, amendment: true)
                result["correction"] = ChangeSummary(correction, location)
                if correction.State == "verified" &&
                    correction
                    .Publication
                    .ValueKind == JsonValueKind.Object &&
                    run.Pr == 0 {
                    result["next"] = ChangeNext(directory, correction)
                }
            }

            if run.State == "failed" {
                let reason = (
                    run.FailureReason == "incomplete_turn" || run.FailureReason == "inference_interrupted"
                ) ? "inference_failed": run.FailureReason

                let code = KnownReason(reason) ? reason: "command_failed"
                result["failure_reason"] = run.FailureReason == "inference_interrupted" ? "inference_interrupted": code
                result["error"] = map[string, Object?]{
                    "code": code,
                    "message": code == "protected_path" ? run.Error: code == "stale_approval" ? "Saved attempt authority is absent or changed. Inspect current authority before fresh preparation.": CliFailure.Message(
                        code
                    )
                }

                if run.Source == "tokate" && run.Pr == 0 && (code == "stale_approval" || code == "inference_failed") {
                    result["next"] = map[string, Object?]{
                        "role": "donor",
                        "action": "Inspect saved work, then use tokate work for a fresh attempt under current authority with an explicit new time budget.",
                        "command": []string{"tokate", "help", "work", "--json"}
                    }
                    if AttemptContinuation.Stopped(run) {
                        result["error"] = map[string, Object?]{
                            "code": code,
                            "message": run.FailureReason == "inference_interrupted" ?
                            "Inference was interrupted. Preserve partial work and prepare a fresh attempt under current authority with a new time budget.":
                            "Runtime limit reached. Preserve partial work and prepare a fresh attempt under unchanged approval with a new time budget."
                        }
                        result["next"] = AttemptContinuation.Next(directory, run)
                    }
                } else if run.Source == "tokate" &&
                    run.Pr == 0 &&
                    run.Commit == "" &&
                    run.TurnCompleted &&
                    run.FailureReason == "public_summary_invalid" {
                    result["next"] = map[string, Object?]{
                        "role": "donor",
                        "action": "Correct tokate-public-summary.json in the saved checkout, then run tokate submit. No new inference is needed.",
                        "command": []string{"tokate", "submit", "--run", directory, "--json"}
                    }
                }
            }
        }

        internal func Artifacts(directory string) Dictionary[string, Object?] {
            let artifacts = map[string, Object?]{}

            for name in[]string{
                "run.json",
                "events.jsonl",
                "stderr.log",
                "report.md",
                "verification.json",
                "candidate.patch",
                "changes.patch",
                "pr-body.md",
                "publication.json",
                "checks.json",
                "record.json"
            } {
                let path = Path.Combine(directory, name)

                if File.Exists(path) {
                    artifacts[name] = path
                }
            }

            for name in[]string{
                "original-evidence",
                "amendments",
                "coding",
                "checkout",
                "coding.staging",
                "checkout.staging"
            } {
                let path = Path.Combine(directory, name)

                if Directory.Exists(path) {
                    artifacts[name.Replace('-', '_')] = path
                }
            }

            return artifacts
        }

        internal func ChangeSummary(change Data, directory string) Object {
            let value = change.Element()
            let result = J.Select(
                value,
                "id,uuid,previous,commit,tree,patch_sha256,seconds,state,pr,elapsed_seconds,verification_seconds"
            )

            let tools = change.Tools

            result["tools"] = Rows(tools, "harness,provider,model,effort,version")
            result["tool_count"] = J.Count(tools)

            let checks = change.Verification

            result["verification"] = Rows(checks, "state,exit_code,output_truncated,error_truncated", true)
            result["verification_count"] = J.Count(checks)

            let reason = change.FailureReason
            let failed = change.State == "failed" || reason != ""
            if failed || change.HasError || change.HasPublicationError {
                let code = KnownReason(reason) ? reason: (
                    reason == "publication_interrupted" ? "command_failed": "invalid_state"
                )
                result["failure_reason"] = code
                result["error"] = map[string, Object?]{"code": code, "message": CliFailure.Message(code)}
            }

            result["artifacts"] = Artifacts(directory)

            return result
        }

        internal func Coordination(value CoordinationState, sha string) Object {
            let result = map[string, Object?]{
                "version": value.Version,
                "repo": value.Repo,
                "issue": value.Issue,
                "approval_id": value.ApprovalId,
                "revoked": value.Revoked
            }

            result["identity"] = value.Identity?.Value()
            result["sha"] = sha

            let approval = value.Approval?.Value() ?? default(JsonElement)
            let summary = J.Select(
                approval,
                "repo,repo_id,issue,donor,approval_scope,eligibility,base,base_branch,authority_branch,policy_hash,template_hash"
            )
            if approval.ValueKind == JsonValueKind.Object {
                let decree = J.Get(approval, "decree")
                if decree.ValueKind != JsonValueKind.Undefined {
                    summary["decree"] = J.Select(decree, "present,sha256")
                }
            }

            result["approval"] = summary
            result["reservation"] = value.Lease?.Display() ?? map[string, Object?]{}
            result["contribution"] = value.Current()?.Outcome.Display() ?? map[string, Object?]{}
            result["outcome_count"] = value.Outcomes.Count

            return result
        }

        private func ChangeNext(directory string, amendment Data) Object {
            let command = List[string]{
                "tokate",
                "amend",
                "--run",
                directory,
                "--commit",
                amendment.Commit,
                "--time",
                amendment.Seconds.ToString() + "s"
            }

            for key in[]string{"tools", "summary"} {
                let argument = key == "tools" ? amendment.ToolsArgument: amendment.SummaryArgument

                if argument != "" {
                    command.AddRange([]string{"--" + key, argument})
                }
            }

            command.Add("--json")
            return map[string, Object?]{
                "role": "donor",
                "action": "Await coordinator outcome, then re-run the same amend command with the original tools and summary options to record publication.",
                "command": command.ToArray()
            }
        }

        internal func Checks(run Data, rows JsonElement, status string, facts Dictionary[string, Object?]) {
            let result = J.Select(run.Element(), "repo,pr,pr_url,commit")

            for fact in facts {
                result[fact.Key] = fact.Value
            }

            result["checks_status"] = status
            result["checks"] = Rows(rows, "name,state,bucket,link,workflow")
            result["check_count"] = J.Count(rows)
            ResultData = result
        }

        internal func Next(options Args?, code string) {
            if RunDirectory != "" {
                try {
                    let run = Data.Load(RunDirectory)
                    let summary = RunSummary(RunDirectory)

                    if code != "" && ResultData is Dictionary[string, Object?]fields {
                        fields["run_state"] = summary
                    } else if ResultData == nil {
                        ResultData = summary
                    }

                    if options != nil && (Command == "amend" || Command == "external") && options.Get("commit") != "" &&
                        ResultData is Dictionary[string, Object?]fields {
                        fields["commit"] = options.Get("commit")
                    }

                    if options != nil && Command == "amend" && ResultData is Dictionary[string, Object?]fields {
                        let location = Path.Combine(RunDirectory, "amendments", options.Get("commit"))

                        if File.Exists(Path.Combine(location, "run.json")) {
                            fields["amendment"] = ChangeSummary(Data.Load(location, amendment: true), location)
                        }
                    }

                    Actions.Add([]string{"tokate", "status", "--run", RunDirectory, "--json"})

                    if run.State == "preparing" &&
                        run.PreparationVersion == Data.PreparationFormatVersion &&
                        code != "stale_approval" {
                        Actions.Add([]string{"tokate", "work", "--run", RunDirectory, "--json"})
                    }

                    if code == "" && run.State == "claimed" && (run.Source == "tokate") {
                        Actions.Add([]string{"tokate", "work", "--run", RunDirectory, "--json"})
                    }

                    var next Object?
                    if summary.TryGetValue("next", out next) &&
                        next is Dictionary[string, Object?]guidance &&
                        guidance["command"] is []string command &&
                        command.Length > 0 {
                        Actions.Add(command)
                    }

                    if Flag("busy") {
                        Actions.RemoveAll(action -> action[1] != "status")
                    } else if code != "stale_approval" && code != "invalid_state" && !Flag("finished") {
                        if run.Pr > 0 {
                            Actions.Add([]string{"tokate", "checks", "--run", RunDirectory, "--json"})
                        } else if (next as Dictionary[string, Object?])?["role"]?.ToString() != "owner" &&
                            (run.State == "generated" || run.State == "incomplete_generated") {
                            Actions.Add([]string{"tokate", "submit", "--run", RunDirectory, "--json"})
                        }
                    }
                } catch (error Exception) { }
            }

            if code == "invalid_arguments" {
                var known bool

                for command in Cli.Commands {
                    known = known || command.Name == Command
                }

                Actions.Add(known ? []string{"tokate", "help", Command, "--json"}: []string{"tokate", "help", "--json"})
            } else if code == "missing_tools" && Command != "doctor" {
                Actions.Add(
                    []string{
                        "tokate",
                        "doctor",
                        Startup.NeedsCatalog(Command, options) ? "managed": "external",
                        "--json"
                    }
                )
            }

            if options != nil && code == "" && Command == "checks" && RunDirectory == "" {
                Actions.Add([]string{"tokate", "checks", options.Get("repo") + "#" + options.Get("pr"), "--json"})
            }
        }

        private func Flag(name string) bool {
            var value Object?
            return ResultData is Dictionary[string, Object?]data && data.TryGetValue(name, out value) &&
                value is bool flag &&
                flag
        }

        internal func Emit(exitCode int32, code string = "", message string = "") int32 {
            var resultCode = exitCode
            let failure Object? = exitCode == 0 ||
                exitCode == Output.PendingExitCode ? nil: map[string, Object?]{
                "code": code == "" ? "command_failed": code,
                "message": Output.Prose(message == "" ? CliFailure.Message(code): message)
            }

            let envelope = map[string, Object?]{
                "schema_version": 1,
                "command": Command,
                "status": exitCode == Output.PendingExitCode ? "pending": (exitCode == 0 ? "ok": "error"),
                "exit_code": exitCode,
                "data": ResultData ?? map[string, Object?]{},
                "error": failure,
                "next_actions": RunReference.Short(Actions, true),
                "truncated": Truncated
            }

            var text = J.Write(envelope)

            if Encoding.UTF8.GetByteCount(text) + 1 > JsonOutputByteLimit {
                envelope["command"] = Command.Length > CommandCharacterLimit ? "unknown": Command
                envelope["status"] = "error"
                envelope["exit_code"] = 1
                envelope["data"] = map[string, Object?]{}
                envelope["error"] = map[string, Object?]{
                    "code": "output_too_large",
                    "message": CliFailure.Message("output_too_large")
                }

                envelope["next_actions"] = []Object{}
                envelope["truncated"] = true
                text = J.Write(envelope)
                resultCode = 1
            }

            Console.WriteLine(text)

            return resultCode
        }
    }
}
