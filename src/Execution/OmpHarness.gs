package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class OmpHarness {
    shared {
        private func Activity(line string) {
            let value = J.Parse(line)
            let event = J.Text(value, "type")
            if event == "message_end" && J.Text(J.Get(value, "message"), "role") == "assistant" {
                for part in J.Items(J.Get(J.Get(value, "message"), "content")) {
                    if J.Text(part, "type") == "text" {
                        DonationView.Append("Assistant: " + J.Text(part, "text"))
                    }
                }
            } else if event == "tool_execution_start" {
                let args = J.Get(value, "args")
                let detail = J.Text(args, "command") == "" ? J.Text(args, "path"): J.Text(args, "command")
                DonationView.Append(J.Text(value, "toolName") + ": " + detail)
            } else if event == "auto_compaction_end" {
                DonationView.Append("Context compacted")
            }
        }

        internal func Select(args Args, policy Policy, source string) JsonElement {
            let provider = RequestData.Token(args.Need("provider"))
            let model = RequestData.ModelIdentifier(args.Need("model"))
            let effort = args.Need("effort")
            policy.ValidateOmp(provider, model, effort, 1)
            if args.Get("availability") == "unavailable" {
                throw Exception("Selected model is donor-reported unavailable; no retry or fallback")
            }
            let runtime = OmpRuntime.Runtime(args)
            let limits = OmpRuntime.Model(args.Need("harness-path"), provider, model)
            OmpRuntime.CheckEffort(limits, effort)
            return J.Parse(
                J.Write(
                    map[string, Object?]{
                        "harness": "omp",
                        "provider": provider,
                        "model": model,
                        "effort": effort,
                        "source": source,
                        "policy_hash": policy.Digest,
                        "policy_eligible": true,
                        "capability": "native OMP CLI with the donor's configuration and tools; no additional isolation",
                        "availability": "listed",
                        "availability_evidence": "OMP lists the exact provider and model ID; credentials, credits and remote identity are unverified",
                        "version": J.Text(runtime, "version"),
                        "context_window": J.Number(limits, "contextWindow"),
                        "max_tokens": J.Number(limits, "maxTokens")
                    }
                )
            )
        }

        internal func ValidateSaved(run Data, policy Policy) {
            policy.ValidateOmp(run.Text("provider"), run.Text("model"), run.Text("effort"), run.Number("seconds"))
            if !Path.IsPathFullyQualified(run.Text("harness_path")) {
                throw Exception("Saved OMP run requires its original executable")
            }
            let args = Args([]string{"work", "--harness", "omp", "--harness-path", run.Text("harness_path")})
            OmpRuntime.Runtime(args)
            if args.Need("harness-path") != run.Text("harness_path") {
                throw Exception("Saved OMP runtime changed; no substitution")
            }
        }

        internal func Execute(directory string, run Data, record JsonElement, prompt string) {
            if run.Number("version") != 2 || run.Text("source") != "tokate" || run.Number("preparation_version") != 1 {
                throw Exception("Managed OMP requires a prepared version-2 contribution")
            }
            let timer = Stopwatch.StartNew()
            let coding = RuntimeBudget(timer, run.Number("seconds") - run.Number("verification_reserve"))
            WorkspacePreparation.Ready(directory, run)
            let options = Args([]string{"work", "--harness", "omp", "--harness-path", run.Text("harness_path")})
            let runtime = OmpRuntime.Runtime(options, coding)
            if options.Need("harness-path") != run.Text("harness_path") {
                throw Exception("Saved OMP runtime changed; no substitution")
            }
            let limits = OmpRuntime.Model(run.Text("harness_path"), run.Text("provider"), run.Text("model"), coding)
            OmpRuntime.CheckEffort(limits, run.Text("effort"))
            let checkout = Path.Combine(directory, "checkout")
            let selector = run.Text("provider") + "/" + run.Text("model")
            let invocation = []string{
                "--mode",
                "json",
                "--no-session",
                "--no-title",
                "--approval-mode",
                "yolo",
                "--model",
                selector,
                "--smol",
                selector,
                "--slow",
                selector,
                "--plan",
                selector,
                "--thinking",
                run.Text("effort") == "absent" ? "off": run.Text("effort")
            }
            let args = OmpRuntime.Command(run.Text("harness_path"))
            args.AddRange(invocation)
            ContributionAuthority.Recheck(run)
            WorkspacePreparation.Ready(directory, run)
            try {
                run.Fields["state"] = "running"
                run.Fields["failure_stage"] = "inference"
                run.Fields["failure_reason"] = "inference_failed"
                run.Fields["omp_version"] = J.Text(runtime, "version")
                run.Fields["observed_invocation"] = map[string, Object?]{
                    "harness": "omp",
                    "version": J.Text(runtime, "version"),
                    "provider": run.Text("provider"),
                    "model": run.Text("model"),
                    "effort": run.Text("effort"),
                    "context_window": J.Number(limits, "contextWindow"),
                    "max_tokens": J.Number(limits, "maxTokens"),
                    "arguments": invocation
                }
                run.Save(directory)
                PublicOutput.FailureCode = "inference_failed"
                var result CommandResult
                {
                    using let progress = TerminalProgress(
                        "OMP inference",
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
                if result.Code != 0 || result.Truncated || result.ReadFailed {
                    let reason = OmpEvidence.Failure(result.Output)
                    throw Exception(
                        (reason == "" ? "OMP did not complete": "OMP did not complete: " + reason) +
                            "; inspect private captured evidence. No new run was started"
                    )
                }
                let usage = OmpEvidence.Completed(directory, result.Output, run.Text("model"), run.Text("provider"))
                run.Fields["turn_completed"] = true
                run.Fields["usage"] = usage
                run.Fields[
                    "usage_provenance"
                ] = "harness-reported for the main session; provider identity, credits and billing are not independently proven"
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
