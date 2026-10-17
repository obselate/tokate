package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json

internal class PublicOutput {
    shared {
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

            if count > 64 {
                Truncated = true
            }

            for i in 0 ... Math.Min(64, count) {
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

                for i in 0 ... Math.Min(64, items.Count) {
                    rows.Add(items[i])
                }

                result[key] = rows
                result[key + "_count"] = items.Count
                Truncated = Truncated || items.Count > 64
            }

            let entries = policy.AllowedTools

            let retained = List[Object]()
            for i in 0 ... Math.Min(64, entries.Count) {
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
            Truncated = Truncated || entries.Count > 64

            return result
        }

        private func PolicyModels(source Dictionary[string, List[string]]) Dictionary[string, Object?] {
            let models = map[string, Object?]{}
            let effortCounts = map[string, Object?]{}
            var count int32

            for model in source {
                count++

                if count <= 64 {
                    let efforts = model.Value
                    let retained = List[Object]()

                    for i in 0 ... Math.Min(64, efforts.Count) {
                        retained.Add(efforts[i])
                    }

                    models[model.Key] = retained
                    effortCounts[model.Key] = efforts.Count
                    Truncated = Truncated || efforts.Count > 64
                }
            }

            Truncated = Truncated || count > 64
            let result = map[string, Object?]{"models": models}
            result["model_count"] = count
            result["model_effort_counts"] = effortCounts

            return result
        }

        internal func RunSummary(directory string) Dictionary[string, Object?] {
            let run = Data.Load(directory)

            if run.Number("version") != 2 {
                throw CliFailure("invalid_state", "Unsupported saved run protocol")
            }

            let value = run.Element()
            let result = J.Select(
                value,
                "version,id,repo,issue,donor,donor_id,head_repo,approval,base,base_branch,policy_hash,model,requested_model,reported_model,effort,seconds,verification_reserve,unlimited,branch,state,state_sha,publication_uuid,source,commit,pr,pr_url,elapsed_seconds,codex_version,pi_version,claude_version,omp_version,output_truncated,error_truncated,preparation_version,preparation_complete,checkout_prepared,attempt,incomplete,partial_source_state,publication_attempt"
            )

            if run.Text("source") == "tokate" {
                result["coding_seconds"] = run.Flag("unlimited") ? nil: run.Number("seconds") - run.Number(
                    "verification_reserve"
                )
                result["verification_reserve"] = run.Number("verification_reserve")
            }

            result["run"] = directory

            if run.Text("state") == "claim_pending" {
                result["next"] = map[string, Object?]{
                    "role": "donor",
                    "action": "Your claim is pending. Check the coordinator outcome with tokate work. If the Tokate workflow failed: " +
                        ApiTransport.MutationRecovery,
                    "command": []string{"tokate", "work", "--run", directory, "--json"}
                }
            }

            if ContributionHandoff.Has(run) {
                result["handoff"] = J.Get(value, "handoff")
            }

            result["storage"] = RunStorage.Summary(directory, run)

            let verification = J.Get(value, "verification")

            result["verification"] = Rows(verification, "state,exit_code,output_truncated,error_truncated", true)
            result["verification_count"] = J.Count(verification)

            if AttemptContinuation.Has(run) {
                result["predecessor"] = J.Get(value, "continuation")
                result["continuation_phase"] = run.Text("continuation_phase")
            }

            let usage = map[string, Object?]{}

            for key in[]string{"input_tokens", "cached_input_tokens", "output_tokens"} {
                let item = J.Get(J.Get(value, "usage"), key)
                var count int64

                if item.ValueKind == JsonValueKind.Number && item.TryGetInt64(out count) && count >= 0 {
                    usage[key] = count
                }
            }

            if usage.Count > 0 {
                result["usage"] = usage
            }

            let tools = J.Get(value, "tools")

            if tools.ValueKind == JsonValueKind.Array {
                result["tools"] = Rows(tools, "harness,provider,model,effort,version")
                result["tool_count"] = J.Count(tools)
            }

            SummarizeChangesAndFailure(directory, run, value, result)

            result["artifacts"] = Artifacts(directory)

            if let guidance = Submission.PendingWorkflow(directory, run) {
                result["coordinator"] = guidance["action"]
                result["next"] = guidance
            }

            if Encoding.UTF8.GetByteCount(J.Write(result)) > 65536 {
                throw CliFailure("output_too_large", CliFailure.Message("output_too_large"))
            }

            return result
        }

        private func SummarizeChangesAndFailure(
            directory string,
            run Data,
            value JsonElement,
            result Dictionary[string, Object?]
        ) {
            let amendments = J.Get(value, "amendments")

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

                    if amendment.Text("state") != "requested" || amendment.Text("previous") != run.Text("commit") {
                        continue
                    }

                    result["amendment"] = ChangeSummary(amendment, location)

                    result["next"] = ChangeNext(directory, amendment)

                    break
                }
            }

            if run.Text("amendment") != "" {
                let location = Path.Combine(directory, "amendments", run.Text("amendment"))
                let correction = Data.Load(location, amendment: true)
                result["correction"] = ChangeSummary(correction, location)
                if correction.Text("state") == "verified" && J.Get(correction.Element(), "publication")
                    .ValueKind == JsonValueKind.Object &&
                    run.Number("pr") == 0 {
                    result["next"] = ChangeNext(directory, correction)
                }
            }

            if run.Text("state") == "failed" {
                let reason = (
                    run.Text("failure_reason") == "incomplete_turn" || run.Text(
                        "failure_reason"
                    ) == "inference_interrupted"
                ) ? "inference_failed": run.Text("failure_reason")

                let code = KnownReason(reason) ? reason: "command_failed"
                result["failure_reason"] = run.Text(
                    "failure_reason"
                ) == "inference_interrupted" ? "inference_interrupted": code
                result["error"] = map[string, Object?]{
                    "code": code,
                    "message": code == "stale_approval" ? "Saved attempt authority is absent or changed. Inspect current authority before fresh preparation.": CliFailure.Message(
                        code
                    )
                }

                if run.Text("source") == "tokate" && run.Number("pr") == 0 &&
                    (code == "stale_approval" || code == "inference_failed") {
                    result["next"] = map[string, Object?]{
                        "role": "donor",
                        "action": "Inspect saved work, then use tokate work for a fresh attempt under current authority with an explicit new time budget.",
                        "command": []string{"tokate", "help", "work", "--json"}
                    }
                    if AttemptContinuation.Stopped(run) {
                        result["error"] = map[string, Object?]{
                            "code": code,
                            "message": run.Text("failure_reason") == "inference_interrupted" ?
                            "Inference was interrupted. Preserve partial work and prepare a fresh attempt under current authority with a new time budget.":
                            "Runtime limit reached. Preserve partial work and prepare a fresh attempt under unchanged approval with a new time budget."
                        }
                        result["next"] = AttemptContinuation.Next(directory, run)
                    }
                } else if run.Text("source") == "tokate" && run.Number("pr") == 0 && run.Text("commit") == "" &&
                    run.Flag("turn_completed") && run.Text("failure_reason") == "public_summary_invalid" {
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

            let tools = J.Get(value, "tools")

            result["tools"] = Rows(tools, "harness,provider,model,effort,version")
            result["tool_count"] = J.Count(tools)

            let checks = J.Get(value, "verification")

            result["verification"] = Rows(checks, "state,exit_code,output_truncated,error_truncated", true)
            result["verification_count"] = J.Count(checks)

            let reason = change.Text("failure_reason")
            let failed = change.Text("state") == "failed" || reason != ""
            if failed || change.Fields.ContainsKey("error") || change.Fields.ContainsKey("publication_error") {
                let code = KnownReason(reason) ? reason: (
                    reason == "publication_interrupted" ? "command_failed": "invalid_state"
                )
                result["failure_reason"] = code
                result["error"] = map[string, Object?]{"code": code, "message": CliFailure.Message(code)}
            }

            result["artifacts"] = Artifacts(directory)

            return result
        }

        internal func Coordination(value JsonElement, sha string) Object {
            let result = J.Select(value, "version,repo,issue,approval_id,revoked")

            result["identity"] = J.Get(value, "identity")
            result["sha"] = sha

            let approval = J.Get(value, "approval")
            let summary = J.Select(
                approval,
                "repo,repo_id,issue,donor,approval_scope,eligibility,base,base_branch,authority_branch,policy_hash,template_hash"
            )

            if Decree.HasSnapshot(approval) {
                summary["decree"] = J.Select(J.Get(approval, "decree"), "present,sha256")
            }

            result["approval"] = summary
            result["reservation"] = J.Select(
                J.Get(value, "reservation"),
                "reservation,lease,donor,actor,created,expires,status,attempt"
            )
            result["contribution"] = J.Select(
                J.Get(CoordinationState.Current(value), "outcome"),
                "pr,url,head,reservation"
            )
            result["outcome_count"] = J.Count(J.Get(value, "outcomes"))

            return result
        }

        private func ChangeNext(directory string, amendment Data) Object {
            let command = List[string]{
                "tokate",
                "amend",
                "--run",
                directory,
                "--commit",
                amendment.Text("commit"),
                "--time",
                amendment.Number("seconds").ToString() + "s"
            }

            for key in[]string{"tools", "summary"} {
                let argument = amendment.Text(key + "_argument")

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

                    if run.Text("state") == "preparing" && run.Number("preparation_version") == 1 &&
                        code != "stale_approval" {
                        Actions.Add([]string{"tokate", "work", "--run", RunDirectory, "--json"})
                    }

                    if code == "" && run.Text("state") == "claimed" && (run.Text("source") == "tokate") {
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
                        if run.Number("pr") > 0 {
                            Actions.Add([]string{"tokate", "checks", "--run", RunDirectory, "--json"})
                        } else if (next as Dictionary[string, Object?])?["role"]?.ToString() != "owner" &&
                            (run.Text("state") == "generated" || run.Text("state") == "incomplete_generated") {
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
                exitCode == 8 ? nil: map[string, Object?]{
                "code": code == "" ? "command_failed": code,
                "message": Output.Prose(message == "" ? CliFailure.Message(code): message)
            }

            let envelope = map[string, Object?]{
                "schema_version": 1,
                "command": Command,
                "status": exitCode == 8 ? "pending": (exitCode == 0 ? "ok": "error"),
                "exit_code": exitCode,
                "data": ResultData ?? map[string, Object?]{},
                "error": failure,
                "next_actions": RunReference.Short(Actions, true),
                "truncated": Truncated
            }

            var text = J.Write(envelope)

            if Encoding.UTF8.GetByteCount(text) + 1 > 65536 {
                envelope["command"] = Command.Length > 2048 ? "unknown": Command
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
