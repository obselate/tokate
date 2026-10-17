package Tokate

import System
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class OmpEvidence {
    shared {
        private const FailureCharacterLimit int32 = 240

        internal func Failure(output string) string {
            var reason = ""

            for line in output.Split('\n') {
                if !line.Contains("\"errorMessage\"", StringComparison.Ordinal) {
                    continue
                }

                try {
                    let message = J.Get(RequestData.Parse(line, SessionEvidence.OmpEventByteLimit), "message")
                    if J.Text(message, "role") == "assistant" && J.Text(message, "errorMessage") != "" {
                        reason = J.Text(message, "errorMessage")
                    }
                } catch (error Exception) when error is CliFailure || error is JsonException {
                    continue
                }
            }

            let text = StringBuilder()

            for character in reason {
                if text.Length == FailureCharacterLimit {
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
