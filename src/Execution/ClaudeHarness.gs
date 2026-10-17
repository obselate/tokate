package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class ClaudeHarness {
    shared {
        internal func Select(args Args, selection Func[Dictionary[string, Object?]]) JsonElement {
            let selected = selection()
            let runtime = ClaudeCode.Runtime(args)

            selected["capability"] = "native configured tools inside whole-process isolation"
            selected["availability"] = "unknown"
            selected[
                "availability_evidence"
            ] = "Native login status and explicit controls do not prove model availability or remote identity"
            selected["version"] = J.Text(runtime, "version")
            return J.Parse(J.Write(selected))
        }

        internal func Doctor(options Args, tool ToolCheck) {
            let authenticate = options.Get("auth") == "true" || options.Get("model") != ""
            let result = ClaudeCode.Runtime(options, authenticate: authenticate)
            tool.Path = options.Need("harness-path")
            tool.Detail = J.Text(result, "version") +
                (
                authenticate ? "; personal native-login status checked.": "; native controls checked without authentication status."
            )
            tool.Report = options.Get("model") == "" ? nil: result
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

        internal func Activity(line string) {
            let value = J.Parse(line)

            if J.Text(value, "type") != "assistant" {
                return
            }

            for item in J.Items(J.Get(J.Get(value, "message"), "content")) {
                if J.Text(item, "type") == "text" {
                    Output.Sink.Append("Assistant: " + J.Text(item, "text"))
                } else if J.Text(item, "type") == "tool_use" {
                    let input = J.Get(item, "input")
                    Output.Sink.Append(
                        J.Text(item, "name") +
                            ": " +
                            (J.Text(input, "command") == "" ? J.Text(input, "file_path"): J.Text(input, "command"))
                    )
                }
            }
        }

        internal func Prepare(
            directory string,
            run Data,
            record JsonElement,
            coding RuntimeBudget,
            models Func[string, string, string, List[string]?]
        ) ValueTuple[[]string, Dictionary[string, Object?]?] {
            let options = Args([]string{"work", "--harness", "claude"})
            options.Values["--harness-path"] = run.Text("harness_path")
            options.Values["--claude-profile"] = run.Text("claude_profile")
            let runtime = ClaudeCode.Runtime(options, coding)
            if options.Need("harness-path") != run.Text("harness_path") || options.Need("claude-profile") != run.Text(
                "claude_profile"
            ) {
                throw ExecutionFailure.Create("invalid_state", "Saved Claude runtime changed; no substitution")
            }

            let checkout = Path.Combine(directory, "checkout")
            let args = List[string](ClaudeCode.Command(run.Text("harness_path"), run.Text("claude_profile"), checkout))
            let allowedModels = models("claude", "anthropic", ClaudeCode.ModelPattern)
            let invocation = ClaudeCode.Invocation(
                run.Text("model"),
                run.Text("effort"),
                run.Text("claude_profile"),
                allowedModels
            )
            args.AddRange(invocation)
            run.Fields["claude_version"] = J.Text(runtime, "version")
            run.Fields["observed_invocation"] = map[string, Object?]{
                "harness": "claude",
                "provider": "anthropic",
                "version": J.Text(runtime, "version"),
                "model": run.Text("model"),
                "effort": run.Text("effort"),
                "arguments": invocation
            }
            return ValueTuple[[]string, Dictionary[string, Object?]?](args.ToArray(), nil)
        }

        internal func Read(
            directory string,
            run Data,
            record JsonElement,
            result CommandResult,
            allowsModel Func[string, bool]
        ) Evidence {
            let evidence = Evidence()
            let reports = ClaudeCode.Reports(result.Output, run.Text("model"), run.Text("effort"), evidence)
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

                    if !allowsModel(name) && !allowsModel(used.Name) {
                        throw ExecutionFailure.Create(
                            "inference_failed",
                            "Claude used " +
                                used.Name +
                                ", which the repository policy does not allow. Remove it from your Claude subagent or model settings."
                        )
                    }
                }
            }

            evidence.Usage = J.Select(J.Get(reports, "usage"), "input_tokens,output_tokens")
            let cached = J.Get(J.Get(reports, "usage"), "cache_read_input_tokens")
            if cached.ValueKind != JsonValueKind.Undefined {
                evidence.Usage["cached_input_tokens"] = cached
            }
            if J.Get(reports, "model").ValueKind == JsonValueKind.String {
                evidence.Model = J.Text(reports, "model")
            }
            run.Fields["native_reports"] = reports
            run.Fields[
                "usage_provenance"
            ] = "harness-reported; remote identity and billing are not independently proven"
            return evidence
        }
    }
}
