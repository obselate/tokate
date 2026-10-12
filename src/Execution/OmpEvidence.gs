package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class OmpEvidence {
    shared {
        internal func Completed(directory string, output string, model string, provider string) Dictionary[
            string,
            Object?
        ] {
            var started bool
            var settled bool
            var lastStop = ""
            var report = ""
            var input int64
            var cached int64
            var generated int64

            for line in output.Split('\n') {
                if String.IsNullOrWhiteSpace(line) {
                    continue
                }

                let item = RequestData.Parse(line, 32 * 1024 * 1024)
                let kind = J.Text(item, "type")

                if settled &&
                    (
                    kind == "agent_start" || kind == "turn_start" || kind.StartsWith(
                        "tool_execution_",
                        StringComparison.Ordinal
                    ) ||
                        (kind == "message_start" || kind == "message_update" || kind == "message_end") &&
                        J.Text(J.Get(item, "message"), "role") != "custom"
                ) {
                    throw Exception("OMP emitted events after its terminal result")
                }

                if kind == "agent_start" {
                    started = true
                } else if kind == "message_end" && J.Text(J.Get(item, "message"), "role") == "assistant" {
                    let message = J.Get(item, "message")
                    if !started || J.Text(message, "model") != model || J.Text(message, "provider") != provider {
                        throw Exception("OMP response differs from the selected model or provider")
                    }

                    lastStop = J.Text(message, "stopReason")
                    report = ""

                    for part in J.Items(J.Get(message, "content")) {
                        if J.Text(part, "type") == "text" {
                            report += J.Text(part, "text")
                        }
                    }

                    let usage = J.Get(message, "usage")
                    input = HarnessUsage.Count(usage, "input", input, "OMP")
                    cached = HarnessUsage.Count(usage, "cacheRead", cached, "OMP")
                    generated = HarnessUsage.Count(usage, "output", generated, "OMP")
                } else if kind == "agent_end" && J.Get(item, "isTerminal").ValueKind != JsonValueKind.False {
                    if lastStop == "length" {
                        throw Exception(
                            "OMP response reached its configured output length limit; inspect the saved partial work"
                        )
                    }

                    if !started || lastStop != "stop" || String.IsNullOrWhiteSpace(report) {
                        throw Exception("OMP did not return a completed response within the donor's allowance")
                    }

                    settled = true
                }
            }

            if !settled {
                throw Exception("OMP did not report a terminal result")
            }

            File.WriteAllText(Path.Combine(directory, "report.md"), report)

            return map[string, Object?]{
                "input_tokens": input,
                "cached_input_tokens": cached,
                "output_tokens": generated
            }
        }

        internal func Failure(output string) string {
            var reason = ""

            for line in output.Split('\n') {
                if !line.Contains("\"errorMessage\"", StringComparison.Ordinal) {
                    continue
                }

                try {
                    let message = J.Get(RequestData.Parse(line, 32 * 1024 * 1024), "message")
                    if J.Text(message, "role") == "assistant" && J.Text(message, "errorMessage") != "" {
                        reason = J.Text(message, "errorMessage")
                    }
                } catch (error Exception) {
                    continue
                }
            }

            let text = StringBuilder()

            for character in reason {
                if text.Length == 240 {
                    break
                }

                text.Append(character < ' ' || character > '~' ? ' ': character)
            }

            return Regex.Replace(
                text.ToString().Trim(),
                "(?i)\\b(sk|pk|rk|key|gh[pousr]|github_pat|xox[a-z])[-_][A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{32,}",
                "[redacted]"
            )
        }
    }
}
