package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class ClaudeHarness {
    shared {
        internal func Select(args Args, policy Policy, source string) JsonElement {
            if args.Need("provider") != "anthropic" || !policy.AllowsTool("claude", "anthropic") {
                throw Exception("Claude/anthropic is not allowed by the repository policy; no inference started.")
            }
            let model = args.Need("model")
            let effort = args.Need("effort")
            policy.Validate(model, effort, 1)
            if !ClaudeCode.Pair(model, effort) {
                throw Exception("Unsupported native Claude model/effort pair; no inference started.")
            }
            if args.Get("availability") == "unavailable" {
                throw Exception("Selected model is donor-reported unavailable; no retry or fallback")
            }
            let runtime = ClaudeCode.Runtime(args)
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "harness": "claude",
                        "provider": "anthropic",
                        "model": model,
                        "effort": effort,
                        "source": source,
                        "policy_hash": policy.Digest,
                        "policy_eligible": true,
                        "capability": "native configured tools inside whole-process isolation",
                        "availability": "unknown",
                        "availability_evidence": "Native login status and explicit controls do not prove model availability or remote identity",
                        "version": J.Text(runtime, "version")
                    }
                )
            )
        }

        internal func ValidateSaved(run Data, policy Policy) {
            policy.ValidateTools(J.Get(run.Element(), "tools"), "tokate")
            policy.Validate(run.Text("model"), run.Text("effort"), run.Number("seconds"))
            if !Path.IsPathFullyQualified(run.Text("claude_profile")) || !Path.IsPathFullyQualified(
                run.Text("harness_path")
            ) {
                throw Exception("Saved Claude run requires its original native-login profile and executable")
            }
        }

        private func Activity(line string) {
            let value = J.Parse(line)
            if J.Text(value, "type") != "assistant" {
                return
            }
            for item in J.Items(J.Get(J.Get(value, "message"), "content")) {
                if J.Text(item, "type") == "text" {
                    DonationView.Append("Assistant: " + J.Text(item, "text"))
                } else if J.Text(item, "type") == "tool_use" {
                    let input = J.Get(item, "input")
                    DonationView.Append(
                        J.Text(item, "name") +
                            ": " +
                            (J.Text(input, "command") == "" ? J.Text(input, "file_path"): J.Text(input, "command"))
                    )
                }
            }
        }

        internal func Execute(directory string, run Data, record JsonElement, prompt string) {
            let timer = Stopwatch.StartNew()
            let coding = RuntimeBudget(timer, run.Number("seconds") - run.Number("verification_reserve"))
            WorkspacePreparation.Ready(directory, run)
            let options = Args(
                []string{
                    "work",
                    "--harness",
                    "claude",
                    "--harness-path",
                    run.Text("harness_path"),
                    "--claude-profile",
                    run.Text("claude_profile")
                }
            )
            let runtime = ClaudeCode.Runtime(options, coding)
            if options.Need("harness-path") != run.Text("harness_path") || options.Need("claude-profile") != run.Text(
                "claude_profile"
            ) {
                throw Exception("Saved Claude runtime changed; no substitution")
            }
            let checkout = Path.Combine(directory, "checkout")
            let args = List[string](ClaudeCode.Command(run.Text("harness_path"), run.Text("claude_profile"), checkout))
            let policy = Policy(J.Write(J.Get(record, "policy")))
            let invocation = ClaudeCode.Invocation(
                run.Text("model"),
                run.Text("effort"),
                run.Text("claude_profile"),
                policy.AllowedModels(ClaudeCode.ModelPattern)
            )
            args.AddRange(invocation)
            ContributionAuthority.Recheck(run)
            WorkspacePreparation.Ready(directory, run)
            try {
                run.Fields["state"] = "running"
                run.Fields["failure_stage"] = "inference"
                run.Fields["failure_reason"] = "inference_failed"
                run.Fields["claude_version"] = J.Text(runtime, "version")
                run.Fields["observed_invocation"] = map[string, Object?]{
                    "harness": "claude",
                    "provider": "anthropic",
                    "version": J.Text(runtime, "version"),
                    "model": run.Text("model"),
                    "effort": run.Text("effort"),
                    "arguments": invocation
                }
                run.Save(directory)
                PublicOutput.FailureCode = "inference_failed"
                var result CommandResult
                {
                    using let progress = TerminalProgress(
                        "Claude inference",
                        coding,
                        RuntimeBudget(timer, run.Flag("unlimited") ? 0: run.Number("seconds"))
                    )
                    var activity Action[string]? = nil
                    if DonationView.Active() {
                        activity = line -> Activity(line)
                    }
                    result = Commands.Run(
                        LocalPaths.NeedSystemTool("env", checkout),
                        args.ToArray(),
                        checkout,
                        prompt,
                        run.Flag("unlimited") ? 0: run.Number("seconds"),
                        cancellation: Chan[bool](1),
                        strictOutput: true,
                        outputPath: Path.Combine(directory, "events.jsonl"),
                        errorPath: Path.Combine(directory, "stderr.log"),
                        budget: coding,
                        outputLine: activity
                    )
                }
                run.Fields["output_truncated"] = result.OutputTruncated
                run.Fields["error_truncated"] = result.ErrorTruncated
                run.Fields["inference_exit_code"] = result.Code
                let reports = ClaudeCode.Reports(result.Output, run.Text("model"), run.Text("effort"), directory)
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw Exception("Claude did not complete; inspect private captured evidence. No retry or fallback")
                }
                let models = J.Get(reports, "model_usage")
                if models.ValueKind == JsonValueKind.Object {
                    for used in models.EnumerateObject() {
                        let name = Regex.Replace(used.Name, "(?:-[0-9]{8})?(?:\\[[^\\]]*\\])?$", "")
                        if !policy.AllowsModel(name) && !policy.AllowsModel(used.Name) {
                            throw Exception(
                                "Claude used " +
                                    used.Name +
                                    ", which the repository policy does not allow. Remove it from your Claude subagent or model settings."
                            )
                        }
                    }
                }
                let usage = J.Select(J.Get(reports, "usage"), "input_tokens,output_tokens")
                let cached = J.Get(J.Get(reports, "usage"), "cache_read_input_tokens")
                if cached.ValueKind != JsonValueKind.Undefined {
                    usage["cached_input_tokens"] = cached
                }
                run.Fields["native_reports"] = reports
                run.Fields["turn_completed"] = true
                run.Fields["usage"] = usage
                run.Fields[
                    "usage_provenance"
                ] = "harness-reported; remote identity and billing are not independently proven"
                run.Fields["execution_seconds"] = Convert.ToInt32(timer.Elapsed.TotalSeconds)
                run.Save(directory)
                PublicOutput.FailureCode = "invalid_state"
                Contribution.Finish(
                    directory,
                    run,
                    record,
                    usage,
                    timer,
                    run.Number("seconds"),
                    run.Number("verification_reserve")
                )
            } catch (error Exception) {
                if run.Text("failure_stage") == "inference" {
                    if let result = Commands.InterruptedResult(error) {
                        run.Fields["failure_reason"] = "inference_interrupted"
                        run.Fields["output_truncated"] = result.OutputTruncated
                        run.Fields["error_truncated"] = result.ErrorTruncated
                    }
                }
                run.Fields["state"] = "failed"
                run.Fields["error"] = error.Message
                run.Save(directory)
                throw error
            }
        }
    }
}
