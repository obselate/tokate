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
            let first = words.Count == 0 ? "": words[0].ToString()
            let named = words.Exists(word -> word.ToString().Contains("{model}"))
            if !named || first.Contains('{') || first.StartsWith('-') || first.Contains('=') ||
                models != JsonValueKind.Object ||
                (output != "codex" && output != "claude" && output != "session") {
                throw Exception(
                    "A command tool needs a fixed executable, a {model} word, models and output codex, claude or session"
                )
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
            if args.Get("consented-command") != "" && args.Get("consented-command") != J.Write(selected["command"]) {
                throw Exception("The owner changed the command after your consent. No inference started.")
            }
            selected["capability"] = "owner-declared command with the donor's tools; no isolation"
            selected["availability"] = "unknown"
            selected["availability_evidence"] = "Tokate does not probe the command, its model or its account"
            return J.Parse(J.Write(selected))
        }

        internal func Text(selection JsonElement) string -> String.Join(
            " ",
            J.Items(J.Get(selection, "command")).Select(word -> word.ToString())
        )

        internal func Adapter(tool JsonElement) Harness {
            let output = J.Text(tool, "output")
            var activity Action[string] = OmpHarness.Activity
            if output == "codex" {
                activity = Worker.Activity
            } else if output == "claude" {
                activity = ClaudeHarness.Activity
            }
            return Harness(
                "Command",
                "",
                "",
                "",
                "Command inference",
                (directory string, run Data, record JsonElement, coding RuntimeBudget) -> Prepare(tool, directory, run),
                (
                    directory string,
                    run Data,
                    record JsonElement,
                    result CommandResult
                ) -> output == "codex" ? Worker.Read(directory, run, record, result):
                output == "claude" ? ClaudeHarness.Read(directory, run, record, result):
                OmpHarness.Read(directory, run, record, result),
                activity,
                Select,
                catalog: true,
                continues: false
            )
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
    }
}
