package Tokate

import System
import System.Collections.Generic
import System.IO

internal class CodexEvidence {
    shared {
        internal func CompletedUsage(directory string, output string) Dictionary[string, Object?] {
            var completed bool
            var completions int32
            var report = ""
            let usage = Dictionary[string, Object?]()
            let events = output.AsSpan()
            for bounds in events.Split('\n') {
                let line = events[bounds]
                if line.IsWhiteSpace() {
                    continue
                }
                let item = J.Parse(line.ToString())
                if J.Text(item, "type") == "turn.started" {
                    completed = false
                    report = ""
                }
                if J.Text(item, "type") == "item.completed" && J.Text(J.Get(item, "item"), "type") == "agent_message" {
                    report = J.Text(J.Get(item, "item"), "text")
                }
                if J.Text(item, "type") == "turn.failed" {
                    throw CliFailure("inference_failed", "Codex reported a failed turn")
                }
                if J.Text(item, "type") == "turn.completed" {
                    completed = true
                    completions++
                    for field in J.Get(item, "usage").EnumerateObject() {
                        usage[field.Name] = field.Value.Clone()
                    }
                }
            }
            if !completed || completions != 1 || String.IsNullOrWhiteSpace(report) {
                throw CliFailure("inference_failed", "Codex did not produce a completed turn and report")
            }
            File.WriteAllText(Path.Combine(directory, "report.md"), report)
            return usage
        }
    }
}
