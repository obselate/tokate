package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class SessionEvidence {
    shared {
        internal const OmpEventByteLimit int32 = 32 * 1024 * 1024

        private const PiEventByteLimit int32 = 4 * 1024 * 1024

        private func Invalid(message string) CliFailure -> ExecutionFailure.Create("inference_failed", message)

        internal func Activity(value JsonElement) bool {
            let event = J.Text(value, "type")
            if event == "message_end" && J.Text(J.Get(value, "message"), "role") == "assistant" {
                for part in J.Items(J.Get(J.Get(value, "message"), "content")) {
                    if J.Text(part, "type") == "text" {
                        Output.Sink.Append("Assistant: " + J.Text(part, "text"))
                    }
                }
            } else if event == "tool_execution_start" {
                let args = J.Get(value, "args")
                let detail = J.Text(args, "command") == "" ? J.Text(args, "path"): J.Text(args, "command")
                Output.Sink.Append(J.Text(value, "toolName") + ": " + detail)
            } else {
                return false
            }
            return true
        }

        internal func Completed(output string, model string, provider string, omp bool = false) Evidence {
            try {
                let harness = omp ? "OMP": "Pi"
                var started bool
                var settled bool
                var lastStop = ""
                let evidence = Evidence{Model: model}
                var input int64
                var cached int64
                var generated int64

                for line in output.Split('\n') {
                    if String.IsNullOrWhiteSpace(line) {
                        continue
                    }

                    let item = RequestData.Parse(line, omp ? OmpEventByteLimit: PiEventByteLimit)
                    let kind = J.Text(item, "type")
                    let message = J.Get(item, "message")
                    let role = J.Text(message, "role")

                    let late = kind == "agent_start" || kind == "turn_start" || if omp {
                        kind.StartsWith("tool_execution_", StringComparison.Ordinal) ||
                            (
                            (kind == "message_start" || kind == "message_update" || kind == "message_end") &&
                                role != "custom"
                        )
                    } else {
                        kind == "message_start" || kind == "message_end" || kind == "agent_settled"
                    }

                    if settled && late {
                        throw Invalid(
                            harness + " emitted events after its " + (omp ? "terminal result": "settled result")
                        )
                    }

                    if kind == "agent_start" {
                        started = true
                    } else if kind == "message_end" && role == "assistant" {
                        if !started || J.Text(message, "model") != model || J.Text(message, "provider") != provider {
                            throw Invalid(harness + " response differs from the selected model or provider")
                        }

                        let responseModel = J.Get(message, "responseModel")
                        if !omp &&
                            responseModel.ValueKind == JsonValueKind.String &&
                            responseModel.GetString() != model {
                            throw Invalid("Pi reported a different response model")
                        }
                        lastStop = J.Text(message, "stopReason")
                        evidence.Report = ""
                        for part in J.Items(J.Get(message, "content")) {
                            if J.Text(part, "type") == "text" {
                                evidence.Report += J.Text(part, "text")
                            }
                        }
                        let usage = J.Get(message, "usage")
                        input = HarnessUsage.Count(usage, "input", input, harness)
                        cached = HarnessUsage.Count(usage, "cacheRead", cached, harness)
                        generated = HarnessUsage.Count(usage, "output", generated, harness)
                    } else if !omp && kind == "compaction_end" {
                        let usage = J.Get(J.Get(item, "result"), "usage")
                        if usage.ValueKind == JsonValueKind.Object {
                            input = HarnessUsage.Count(usage, "input", input, harness)
                            cached = HarnessUsage.Count(usage, "cacheRead", cached, harness)
                            generated = HarnessUsage.Count(usage, "output", generated, harness)
                        }
                    } else if omp ? kind == "agent_end" && J.Get(item, "isTerminal").ValueKind != JsonValueKind.False:
                    kind == "agent_settled" {
                        if lastStop == "length" {
                            throw Invalid(
                                harness +
                                    " response reached its configured output length limit; inspect the saved partial work"
                            )
                        }

                        let aborted = !omp && J.Get(item, "aborted").ValueKind != JsonValueKind.False
                        if !started || aborted || lastStop != "stop" || String.IsNullOrWhiteSpace(evidence.Report) {
                            throw Invalid(harness + " did not return a completed response within the donor's allowance")
                        }
                        settled = true
                    }
                }

                if !settled {
                    throw Invalid(harness + " did not report a " + (omp ? "terminal result": "settled run"))
                }

                evidence.Usage = map[string, Object?]{
                    "input_tokens": input,
                    "cached_input_tokens": cached,
                    "output_tokens": generated
                }
                return evidence
            } catch (error JsonException) {
                throw ExecutionFailure.From(error, "inference_failed")
            }
        }
    }
}

internal class HarnessUsage {
    shared {
        private const SafeJsonIntegerLimit int64 = 9007199254740991

        internal func Count(value JsonElement, key string, total int64, harness string) int64 {
            let number = J.Get(value, key)
            var count int64

            if number.ValueKind != JsonValueKind.Number || !number.TryGetInt64(out count) ||
                count < 0 ||
                count > SafeJsonIntegerLimit {
                throw ExecutionFailure.Create("inference_failed", "Invalid harness-reported " + harness + " usage")
            }

            if total > SafeJsonIntegerLimit - count {
                throw ExecutionFailure.Create("inference_failed", harness + " usage exceeds its safe integer range")
            }
            return total + count
        }
    }
}
