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
            let selected = DonorSelection.Selection(args, policy, source)
            let runtime = ClaudeCode.Runtime(args)

            selected["capability"] = "native configured tools inside whole-process isolation"
            selected["availability"] = "unknown"
            selected[
                "availability_evidence"
            ] = "Native login status and explicit controls do not prove model availability or remote identity"
            selected["version"] = J.Text(runtime, "version")
            return J.Parse(J.Write(selected))
        }

        internal func ValidateSaved(run Data) {
            if !Path.IsPathFullyQualified(run.Text("claude_profile")) || !Path.IsPathFullyQualified(
                run.Text("harness_path")
            ) {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Saved Claude run requires its original native-login profile and executable"
                )
            }
        }

        internal func Execute(directory string, run Data, record JsonElement) {
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
                throw ExecutionFailure.Create("invalid_state", "Saved Claude runtime changed; no substitution")
            }

            let checkout = Path.Combine(directory, "checkout")
            let args = List[string](ClaudeCode.Command(run.Text("harness_path"), run.Text("claude_profile"), checkout))
            let policy = Policy(J.Write(J.Get(record, "policy")), gratis: run.Flag("gratis"))
            let invocation = ClaudeCode.Invocation(
                run.Text("model"),
                run.Text("effort"),
                run.Text("claude_profile"),
                policy.AllowedModels("claude", "anthropic", ClaudeCode.ModelPattern)
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

                    result = Commands.Run(
                        LocalPaths.NeedSystemTool("env", checkout),
                        args.ToArray(),
                        checkout,
                        TaskContext.Build(checkout, run, record, coding),
                        run.Flag("unlimited") ? 0: run.Number("seconds"),
                        cancellation: Chan[bool](1),
                        strictOutput: true,
                        outputPath: Path.Combine(directory, "events.jsonl"),
                        errorPath: Path.Combine(directory, "stderr.log"),
                        budget: coding
                    )
                }

                run.Fields["output_truncated"] = result.OutputTruncated
                run.Fields["error_truncated"] = result.ErrorTruncated
                run.Fields["inference_exit_code"] = result.Code

                let reports = ClaudeCode.Reports(result.Output, run.Text("model"), run.Text("effort"), directory)
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    throw ExecutionFailure.Create(
                        "inference_failed",
                        "Claude did not complete; inspect private captured evidence. No retry or fallback"
                    )
                }

                let models = J.Get(reports, "model_usage")
                if models.ValueKind == JsonValueKind.Object {
                    for used in models.EnumerateObject() {
                        let name = Regex.Replace(used.Name, "(?:-[0-9]{8})?(?:\\[[^\\]]*\\])?$", "")

                        if !policy.AllowsModel("claude", "anthropic", name) && !policy.AllowsModel(
                            "claude",
                            "anthropic",
                            used.Name
                        ) {
                            throw ExecutionFailure.Create(
                                "inference_failed",
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

                run.Fields["reported_model"] = J.Get(reports, "model").ValueKind == JsonValueKind.String ? J.Text(
                    reports,
                    "model"
                ): nil
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
            } catch (error Exception) when error is CliFailure ||
                error is CommandInterrupted ||
                error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
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

                throw ExecutionFailure.From(error, PublicOutput.FailureCode)
            }
        }
    }
}
