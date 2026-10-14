package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class CodexEvidence {
    shared {
        internal func Completed(output string) Evidence {
            try {
                var completed bool
                var completions int32
                let evidence = Evidence()
                let events = output.AsSpan()

                for bounds in events.Split('\n') {
                    let line = events[bounds]
                    if line.IsWhiteSpace() {
                        continue
                    }

                    let item = J.Parse(line.ToString())

                    if J.Text(item, "type") == "turn.started" {
                        completed = false
                        evidence.Report = ""
                    }

                    if J.Text(item, "type") == "item.completed" && J.Text(
                        J.Get(item, "item"),
                        "type"
                    ) == "agent_message" {
                        evidence.Report = J.Text(J.Get(item, "item"), "text")
                    }

                    if J.Text(item, "type") == "turn.failed" {
                        throw CliFailure("inference_failed", "Codex reported a failed turn")
                    }

                    if J.Text(item, "type") == "turn.completed" {
                        completed = true
                        completions++

                        for field in J.Get(item, "usage").EnumerateObject() {
                            evidence.Usage[field.Name] = field.Value.Clone()
                        }
                    }
                }

                if !completed || completions != 1 || String.IsNullOrWhiteSpace(evidence.Report) {
                    throw CliFailure("inference_failed", "Codex did not produce a completed turn and report")
                }
                return evidence
            } catch (error Exception) when error is JsonException ||
                error.GetType() == typeof(InvalidOperationException) {
                throw ExecutionFailure.From(error, "inference_failed")
            }
        }
    }
}
