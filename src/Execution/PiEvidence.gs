package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class PiEvidence {
    shared {
        internal func Completed(directory string, output string, model string, provider string) Dictionary[
            string,
            Object?
        ] {
            try {
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

                    let item = RequestData.Parse(line, 4 * 1024 * 1024)
                    let kind = J.Text(item, "type")

                    if settled &&
                        (
                        kind == "agent_start" ||
                            kind == "turn_start" ||
                            kind == "message_start" ||
                            kind == "message_end" ||
                            kind == "agent_settled"
                    ) {
                        throw ExecutionFailure.Create("inference_failed", "Pi emitted events after its settled result")
                    }

                    if kind == "agent_start" {
                        started = true
                    } else if kind == "message_end" && J.Text(J.Get(item, "message"), "role") == "assistant" {
                        let message = J.Get(item, "message")
                        if !started || J.Text(message, "model") != model || J.Text(message, "provider") != provider {
                            throw ExecutionFailure.Create(
                                "inference_failed",
                                "Pi response differs from the selected model or provider"
                            )
                        }

                        let responseModel = J.Get(message, "responseModel")
                        if responseModel.ValueKind == JsonValueKind.String && responseModel.GetString() != model {
                            throw ExecutionFailure.Create("inference_failed", "Pi reported a different response model")
                        }

                        lastStop = J.Text(message, "stopReason")
                        report = ""

                        for part in J.Items(J.Get(message, "content")) {
                            if J.Text(part, "type") == "text" {
                                report += J.Text(part, "text")
                            }
                        }

                        let usage = J.Get(message, "usage")
                        input = HarnessUsage.Count(usage, "input", input, "Pi")
                        cached = HarnessUsage.Count(usage, "cacheRead", cached, "Pi")
                        generated = HarnessUsage.Count(usage, "output", generated, "Pi")
                    } else if kind == "compaction_end" {
                        let usage = J.Get(J.Get(item, "result"), "usage")
                        if usage.ValueKind == JsonValueKind.Object {
                            input = HarnessUsage.Count(usage, "input", input, "Pi")
                            cached = HarnessUsage.Count(usage, "cacheRead", cached, "Pi")
                            generated = HarnessUsage.Count(usage, "output", generated, "Pi")
                        }
                    } else if kind == "agent_settled" {
                        if lastStop == "length" {
                            throw ExecutionFailure.Create(
                                "inference_failed",
                                "Pi response reached its configured output length limit; inspect the saved partial work"
                            )
                        }

                        if !started || J.Get(item, "aborted")
                            .ValueKind != JsonValueKind.False ||
                            lastStop != "stop" ||
                            String
                            .IsNullOrWhiteSpace(report) {
                            throw ExecutionFailure.Create(
                                "inference_failed",
                                "Pi did not return a completed response within the donor's allowance"
                            )
                        }

                        settled = true
                    }
                }

                if !settled {
                    throw ExecutionFailure.Create("inference_failed", "Pi did not report a settled run")
                }

                File.WriteAllText(Path.Combine(directory, "report.md"), report)

                return map[string, Object?]{
                    "input_tokens": input,
                    "cached_input_tokens": cached,
                    "output_tokens": generated
                }
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "inference_failed")
            }
        }
    }
}

internal class HarnessUsage {
    shared {
        internal func Count(value JsonElement, key string, total int64, harness string) int64 {
            let number = J.Get(value, key)
            var count int64

            if number.ValueKind != JsonValueKind.Number || !number.TryGetInt64(out count) ||
                count < 0 ||
                count > 9007199254740991 {
                throw ExecutionFailure.Create("inference_failed", "Invalid harness-reported " + harness + " usage")
            }

            if total > 9007199254740991 - count {
                throw ExecutionFailure.Create("inference_failed", harness + " usage exceeds its safe integer range")
            }

            return total + count
        }
    }
}
