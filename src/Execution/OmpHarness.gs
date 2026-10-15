package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class OmpHarness {
    shared {
        internal func Activity(line string) {
            let value = J.Parse(line)
            let event = J.Text(value, "type")

            if SessionEvidence.Activity(value) {
                return
            } else if event == "auto_compaction_end" {
                DonationView.Append("Context compacted")
            }
        }

        internal func Select(args Args, policy Policy, source string) JsonElement {
            let provider = RequestData.Token(args.Need("provider"))
            let model = RequestData.ModelIdentifier(args.Need("model"))
            let effort = args.Need("effort")

            let selected = DonorSelection.Selection(args, policy, source)
            let runtime = OmpRuntime.Runtime(args)
            let limits = OmpRuntime.Model(args.Need("harness-path"), provider, model)
            OmpRuntime.CheckEffort(limits, effort)

            selected["capability"] = "native OMP CLI with the donor's configuration and tools; no additional isolation"
            selected["availability"] = "listed"
            selected[
                "availability_evidence"
            ] = "OMP lists the exact provider and model ID; credentials, credits and remote identity are unverified"
            selected["version"] = J.Text(runtime, "version")
            selected["context_window"] = J.Number(limits, "contextWindow")
            selected["max_tokens"] = J.Number(limits, "maxTokens")
            return J.Parse(J.Write(selected))
        }

        internal func Doctor(options Args, tool ToolCheck) {
            let result = OmpRuntime.Runtime(options)
            let models = OmpRuntime.Models(options.Need("harness-path"))
            if models.Count == 0 {
                throw Exception("OMP lists no models. Sign in with omp login or configure a provider.")
            }
            tool.Path = options.Need("harness-path")
            tool.Detail = "OMP " + J.Text(result, "version") + "; " + models.Count.ToString() +
                " configured models listed without inference or credential checks."
        }

        internal func ValidateSaved(run Data) {
            if !Path.IsPathFullyQualified(run.Text("harness_path")) {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP run requires its original executable")
            }

            let args = Args([]string{"work", "--harness", "omp", "--harness-path", run.Text("harness_path")})
            OmpRuntime.Runtime(args)
            if args.Need("harness-path") != run.Text("harness_path") {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP runtime changed; no substitution")
            }
        }

        internal func Prepare(directory string, run Data, record JsonElement, coding RuntimeBudget) ValueTuple[
            []string,
            Dictionary[string, Object?]?
        ] {
            let options = Args([]string{"work", "--harness", "omp", "--harness-path", run.Text("harness_path")})
            let runtime = OmpRuntime.Runtime(options, coding)
            if options.Need("harness-path") != run.Text("harness_path") {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP runtime changed; no substitution")
            }

            let limits = OmpRuntime.Model(run.Text("harness_path"), run.Text("provider"), run.Text("model"), coding)
            OmpRuntime.CheckEffort(limits, run.Text("effort"))

            let selector = run.Text("provider") + "/" + run.Text("model")

            let invocation = List[string]{"--mode", "json", "--no-session", "--no-title", "--approval-mode", "yolo"}
            for flag in[]string{"--model", "--smol", "--slow", "--plan"} {
                invocation.Add(flag)
                invocation.Add(selector)
            }
            invocation.Add("--thinking")
            invocation.Add(run.Text("effort") == "absent" ? "off": run.Text("effort"))
            let args = OmpRuntime.Command(run.Text("harness_path"))
            args.AddRange(invocation)
            run.Fields["omp_version"] = J.Text(runtime, "version")
            run.Fields["observed_invocation"] = map[string, Object?]{
                "harness": "omp",
                "version": J.Text(runtime, "version"),
                "provider": run.Text("provider"),
                "model": run.Text("model"),
                "effort": run.Text("effort"),
                "context_window": J.Number(limits, "contextWindow"),
                "max_tokens": J.Number(limits, "maxTokens"),
                "arguments": invocation.ToArray()
            }
            return ValueTuple[[]string, Dictionary[string, Object?]?](args.ToArray(), nil)
        }

        internal func Read(directory string, run Data, record JsonElement, result CommandResult) Evidence {
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                let reason = OmpEvidence.Failure(result.Output)
                throw ExecutionFailure.Create(
                    "inference_failed",
                    (reason == "" ? "OMP did not complete": "OMP did not complete: " + reason) +
                        "; inspect private captured evidence. No new run was started"
                )
            }
            let evidence = SessionEvidence.Completed(result.Output, run.Text("model"), run.Text("provider"), omp: true)
            run.Fields[
                "usage_provenance"
            ] = "harness-reported for the main session; provider identity, credits and billing are not independently proven"
            return evidence
        }
    }
}
