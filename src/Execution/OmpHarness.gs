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
                Output.Sink.Append("Context compacted")
            }
        }

        internal func Select(args Args, selection Func[Dictionary[string, Object?]]) JsonElement {
            let provider = RequestData.Token(args.Need("provider"))
            let model = RequestData.ModelIdentifier(args.Need("model"))
            let effort = args.Need("effort")

            let selected = selection()
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
                " configured models listed without inference or credential checks. " +
                Role(OmpRuntime.DefaultRole(tool.Path), models)
        }

        private func Role(selector string, models List[JsonElement]) string {
            if selector == "" {
                return "No default role model in OMP config."
            }

            var model = selector
            var effort = "not set"
            let split = selector.LastIndexOf(':')

            if split > 0 && !models.Exists(entry -> J.Text(entry, "selector") == selector) {
                model = selector.Substring(0, split)
                effort = selector.Substring(split + 1)
            }

            let slash = model.IndexOf('/')
            return "Default role: provider " +
                (slash < 0 ? "not set": model.Substring(0, slash)) +
                ", model " +
                model.Substring(slash + 1) + ", effort " + effort + "."
        }

        internal func ValidateSaved(run Data) {
            if !Path.IsPathFullyQualified(run.HarnessPath) {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP run requires its original executable")
            }

            let args = Args([]string{"work", "--harness", "omp", "--harness-path", run.HarnessPath})
            OmpRuntime.Runtime(args)
            if args.Need("harness-path") != run.HarnessPath {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP runtime changed; no substitution")
            }
        }

        internal func Prepare(
            directory string,
            run Data,
            record JsonElement,
            coding RuntimeBudget,
            models Func[string, string, string, List[string]?]
        ) ValueTuple[[]string, Action[Data]?] {
            let options = Args([]string{"work", "--harness", "omp", "--harness-path", run.HarnessPath})
            let runtime = OmpRuntime.Runtime(options, coding)
            if options.Need("harness-path") != run.HarnessPath {
                throw ExecutionFailure.Create("invalid_state", "Saved OMP runtime changed; no substitution")
            }

            let limits = OmpRuntime.Model(run.HarnessPath, run.Provider, run.Model, coding)
            OmpRuntime.CheckEffort(limits, run.Effort)

            let selector = run.Provider + "/" + run.Model

            let invocation = List[string]{"--mode", "json", "--no-session", "--no-title", "--approval-mode", "yolo"}
            for flag in[]string{"--model", "--smol", "--slow", "--plan"} {
                invocation.Add(flag)
                invocation.Add(selector)
            }
            invocation.Add("--thinking")
            invocation.Add(run.Effort == "absent" ? "off": run.Effort)
            let args = OmpRuntime.Command(run.HarnessPath)
            args.AddRange(invocation)
            run.OmpVersion = J.Text(runtime, "version")
            run.ObservedInvocation = J.Parse(
                J.Write(
                    map[string, Object?]{
                        "harness": "omp",
                        "version": J.Text(runtime, "version"),
                        "provider": run.Provider,
                        "model": run.Model,
                        "effort": run.Effort,
                        "context_window": J.Number(limits, "contextWindow"),
                        "max_tokens": J.Number(limits, "maxTokens"),
                        "arguments": invocation.ToArray()
                    }
                )
            )
            return ValueTuple[[]string, Action[Data]?](args.ToArray(), nil)
        }

        internal func Read(
            directory string,
            run Data,
            record JsonElement,
            result CommandResult,
            allowsModel Func[string, bool]
        ) Evidence {
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                let reason = OmpEvidence.Failure(result.Output)
                throw ExecutionFailure.Create(
                    "inference_failed",
                    (reason == "" ? "OMP did not complete": "OMP did not complete: " + reason) +
                        "; inspect private captured evidence. No new run was started"
                )
            }
            let evidence = SessionEvidence.Completed(result.Output, run.Model, run.Provider, omp: true)
            run.UsageProvenance = "harness-reported for the main session; provider identity, credits and billing are not independently proven"
            return evidence
        }
    }
}
