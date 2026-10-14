package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json
import System.Text.RegularExpressions

internal class CommandHarness {
    shared {
        private let Placeholders string = "\\{(prompt_file|model|effort|checkout)\\}"

        internal func Validate(tool JsonElement) {
            let words = J.Items(J.Get(tool, "command"))
            let output = J.Text(tool, "output")
            let models = J.Get(tool, "models").ValueKind
            if words.Count == 0 || words[0].ToString().Contains('{') ||
                models != JsonValueKind.Object ||
                (output != "codex" && output != "claude" && output != "session") {
                throw Exception("A command tool needs a fixed executable, models and output codex, claude or session")
            }

            for word in words {
                let text = word.ValueKind == JsonValueKind.String ? word.GetString() ?? "": ""
                if text.Trim() == "" || Regex.Replace(text, Placeholders, "").IndexOfAny([]char{'{', '}'}) >= 0 {
                    throw Exception(
                        "Command words must be text with only {prompt_file}, {model}, {effort} or {checkout}"
                    )
                }
            }
        }

        internal func Select(args Args, policy Policy, source string) JsonElement {
            let selected = DonorSelection.Selection(args, policy, source)
            selected["command"] = J.Get(policy.Tool("command", args.Need("provider")), "command")
            selected["capability"] = "owner-declared command with the donor's tools; no isolation"
            selected["availability"] = "unknown"
            selected["availability_evidence"] = "Tokate does not probe the command, its model or its account"
            return J.Parse(J.Write(selected))
        }

        internal func Adapter(tool JsonElement) Harness {
            let output = J.Text(tool, "output")
            return Harness(
                "Command inference",
                (directory, run, record, coding) -> Prepare(tool, directory, run),
                (directory, run, record, result) -> output == "codex" ? Worker.Read(directory, run, record, result):
                output == "claude" ? ClaudeHarness.Read(directory, run, record, result): Read(directory, run, result),
                line -> Activity(output, line)
            )
        }

        private func Activity(output string, line string) {
            if output == "codex" {
                Worker.Activity(line)
            } else if output == "claude" {
                ClaudeHarness.Activity(line)
            } else {
                SessionEvidence.Activity(J.Parse(line))
            }
        }

        private func Prepare(tool JsonElement, directory string, run Data) ValueTuple[
            []string,
            Dictionary[string, Object?]?
        ] {
            let values = map[string, string]{
                "prompt_file": Path.Combine(directory, "prompt.md"),
                "model": run.Text("model"),
                "effort": run.Text("effort"),
                "checkout": Path.Combine(directory, "checkout")
            }
            let args = J
                .Items(J.Get(tool, "command"))
                .Select(
                word -> Regex.Replace(
                    word.GetString() ?? "",
                    Placeholders,
                    (match Match) -> values[match.Groups[1].Value]
                )
            )
                .ToArray()
            let invocation = map[string, Object?]{
                "harness": "command",
                "provider": run.Text("provider"),
                "model": run.Text("model"),
                "effort": run.Text("effort"),
                "output": J.Text(tool, "output"),
                "arguments": args
            }
            return ValueTuple[[]string, Dictionary[string, Object?]?](
                args,
                map[string, Object?]{"observed_invocation": invocation}
            )
        }

        private func Read(directory string, run Data, result CommandResult) Dictionary[string, Object?] {
            if result.Code != 0 || result.Truncated || result.ReadFailed {
                throw ExecutionFailure.Create(
                    "inference_failed",
                    "The command harness did not complete; inspect private captured evidence. No new run was started"
                )
            }
            let usage = SessionEvidence.Completed(
                directory,
                result.Output,
                run.Text("model"),
                run.Text("provider"),
                omp: true
            )
            run.Fields["reported_model"] = run.Text("model")
            run.Fields["usage_provenance"] = "harness-reported; identity and billing are not independently proven"
            return usage
        }
    }
}
