package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class PublicSummary {
    shared {
        internal let Artifact string = "tokate-public-summary.json"
        private let Unavailable string = "Change summary unavailable for this candidate; review the diff."
        private let Section string = "\nVerification:\n"
        private let CiNote string = "- GitHub CI: not assessed here; missing or pending checks are not success."
        private let Missing string = "PR report has no change summary for this candidate. Supply a current public summary and republish."
        private let Incomplete string = "PR report omits the public change or verification report region. Restore the Tokate report before acceptance."
        private let Altered string = "PR report differs from the authoritative public summary for this exact candidate. Restore it or amend with a current summary."
        internal let RestrictedTextPattern string = "(?i)(https?:|www\\.|\\b[A-Z]:|gh[pousr]_|github_pat_|\\bsk-|bearer|password|api[ _-]?key|credential|secret|tokate-receipt|tokate-report|localhost:|[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+|[a-z]+://|generated a patch|implemented acceptance criteria)"

        internal func Validate(value JsonElement, head string = "") {
            let limit = J.Get(value, "head").ValueKind == JsonValueKind.Undefined ? 4046: 4096

            RequestData.Parse(J.Write(value), limit)
            RequestData.Keys(value, "head,changes,verification,limitations")

            if head != "" && J.Text(value, "head") != head {
                throw CliFailure("invalid_state", "Set head in the summary to " + head + ".")
            }

            if J.Get(value, "head").ValueKind != JsonValueKind.Undefined {
                RepositoryIdentity.CommitSha(J.Text(value, "head"))
            }

            for key in[]string{"changes", "verification", "limitations"} {
                let list = J.Get(value, key)

                if list.ValueKind != JsonValueKind.Array || list.GetArrayLength() > (key == "limitations" ? 4: 8) ||
                    (key == "changes" && list.GetArrayLength() == 0) {
                    throw CliFailure(
                        "invalid_state",
                        "Public summary needs bounded changes, verification and limitations lists"
                    )
                }

                var index int32

                for item in list.EnumerateArray() {
                    let text = item.ValueKind == JsonValueKind.String ? item.GetString() ?? "": ""

                    if item.ValueKind != JsonValueKind.String || !Safe(text) {
                        let rejected = Regex.Match(text, "[^A-Za-z0-9 .,;:!?()'+_=-]")
                        let restricted = Regex.Match(text, RestrictedTextPattern)

                        throw CliFailure(
                            "invalid_state",
                            "Public summary " + key + "[" + index.ToString() +
                                "] contains invalid public text" +
                                (rejected.Success ? "; first disallowed character " + J.Write(rejected.Value): "") +
                                (
                                restricted.Success ? "; matched disallowed public text pattern " + J.Write(
                                    restricted.Value
                                ): ""
                            )
                        )
                    }

                    index++
                }
            }
        }

        private func Safe(text string) bool -> text.Length >= 3 && text.Length <= 200 && text == text.Trim() &&
            Regex.IsMatch(text, "^[A-Za-z0-9 .,;:!?()'+_=-]+$") && !Regex.IsMatch(text, RestrictedTextPattern)

        internal func FileSummary(path string, head string) JsonElement {
            try {
                if path == "" {
                    return JsonElement{}
                }

                if FileInfo(path).LinkTarget != nil {
                    throw CliFailure("invalid_state", "Public summary must not be a symbolic link")
                }

                let size = FileInfo(path).Length

                if size < 1 || size > 4096 {
                    throw CliFailure("invalid_state", "Public summary must contain 1 to 4096 bytes")
                }

                let value = RequestData.FileData(path, 4096)

                Validate(value, head)

                return value
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        internal func Capture(directory string, checkout string, run Data) {
            try {
                let path = Path.Combine(checkout, Artifact)

                if !File.Exists(path) && FileInfo(path).LinkTarget == nil {
                    return
                }

                if Commands.Git(checkout, "ls-files", "--", Artifact) != "" {
                    throw CliFailure("invalid_state", "Public summary artifact conflicts with a repository-owned file")
                }

                let summary = FileSummary(path, "")

                if J.Get(summary, "head").ValueKind != JsonValueKind.Undefined {
                    throw CliFailure(
                        "invalid_state",
                        "Managed public summary must omit head; Tokate binds the final patch"
                    )
                }

                run.PublicSummary = summary
                run.ClearSummaryPatchSha256()

                File.Delete(path)

                run.Save(directory)
            } catch (error Exception) when error is IOException || error is UnauthorizedAccessException {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        internal func Bind(run Data, patch string) {
            let summary = run.PublicSummary

            if summary.ValueKind == JsonValueKind.Undefined {
                return
            }

            Validate(summary)

            if run.SummaryPatchSha256 == "" {
                run.SummaryPatchSha256 = J.Hash(patch)
            } else if run.SummaryPatchSha256 != J.Hash(patch) {
                run.ClearPublicSummary()
                run.ClearSummaryPatchSha256()
            }
        }

        internal func ForHead(run Data, head string) JsonElement {
            let summary = run.PublicSummary

            if summary.ValueKind == JsonValueKind.Undefined {
                return summary
            }

            Validate(summary)

            if J.Text(summary, "head") != "" {
                Validate(summary, head)

                return summary
            }

            let fields = map[string, Object?]{"head": head}

            for field in summary.EnumerateObject() {
                fields[field.Name] = field.Value.Clone()
            }

            let bound = J.Parse(J.Write(fields))

            Validate(bound, head)

            return bound
        }

        internal func Attach(metadata Dictionary[string, Object?], summary JsonElement) Dictionary[string, Object?] {
            if summary.ValueKind != JsonValueKind.Undefined {
                metadata["summary"] = summary
            }

            return metadata
        }

        private func Changes(summary JsonElement) string {
            var result = ""

            for item in J.Items(J.Get(summary, "changes")) {
                result += "- " + (item.GetString() ?? "") + "\n"
            }

            return result
        }

        internal func Current(report string, summary JsonElement, head string, expected string = "") {
            if expected != "" && report != expected {
                throw CliFailure("invalid_state", Altered)
            }

            let split = report.IndexOf(Section, StringComparison.Ordinal)

            if report == "" || split < 0 || !report.Contains(CiNote) {
                throw CliFailure("invalid_state", Incomplete)
            }

            var useful bool

            for line in report.Substring(0, split).Split('\n') {
                if !line.StartsWith("- ") {
                    continue
                }

                if !Safe(line.Substring(2).Trim()) {
                    throw CliFailure("invalid_state", Incomplete)
                }

                useful = true
            }

            if !useful || report.Contains(Unavailable) {
                throw CliFailure("invalid_state", Missing)
            }

            if summary.ValueKind == JsonValueKind.Undefined {
                return
            }

            Validate(summary, head)

            if !report.Contains(Changes(summary)) {
                throw CliFailure("invalid_state", Altered)
            }
        }

        internal func Report(summary JsonElement, observed string) string {
            var result = ""

            if summary.ValueKind == JsonValueKind.Undefined {
                result = "- " + Unavailable + "\n"
            } else {
                Validate(summary)
                result = Changes(summary)
            }

            result += Section + "\n- " + observed + "\n"

            if summary.ValueKind != JsonValueKind.Undefined {
                for item in J.Items(J.Get(summary, "verification")) {
                    result += "- Donor-reported: " + (item.GetString() ?? "") + "\n"
                }
            }

            result += CiNote

            if summary.ValueKind != JsonValueKind.Undefined && J.Items(J.Get(summary, "limitations")).Count > 0 {
                result += "\n\nLimits:\n"

                for item in J.Items(J.Get(summary, "limitations")) {
                    result += "\n- " + (item.GetString() ?? "")
                }
            }

            return result
        }

        internal func Duration(seconds int64) string {
            let parts = []int64{
                seconds / RuntimeBudget.SecondsPerDay,
                seconds / RuntimeBudget.SecondsPerHour % 24,
                seconds / RuntimeBudget.SecondsPerMinute % RuntimeBudget.MinutesPerHour,
                seconds % RuntimeBudget.SecondsPerMinute
            }
            var result = ""

            for i in 0 ... 4 {
                if result != "" || parts[i] > 0 || i == 3 {
                    result += parts[i].ToString() + "dhms".Substring(i, 1) + " "
                }
            }

            return result.Trim()
        }

        internal func Count(value int64) string {
            if value < 1000 {
                return value.ToString()
            }

            var scaled = value / 1000.0
            var unit int32

            while scaled >= 999.5 && unit < 2 {
                scaled /= 1000
                unit += 1
            }

            return scaled.ToString(scaled < 100 ? "0.#": "0") + "KMB".Substring(unit, 1)
        }

        internal func Usage(value JsonElement) string {
            let usage = UsageReport.Parse(value)

            return (usage.InputTokens >= 0 ? Count(usage.InputTokens): "unknown") +
                " | " +
                (usage.OutputTokens >= 0 ? Count(usage.OutputTokens): "unknown") +
                " | " +
                (usage.CachedInputTokens >= 0 ? Count(usage.CachedInputTokens): "unknown")
        }

        internal func Tools(tools JsonElement, label string) string {
            var result = "\n\n| " +
                label +
                " | Model / effort | Coding time | Input tokens | Output tokens | Cached tokens |\n" +
                "| --- | --- | --- | --- | --- | --- |"

            if J.Items(tools).Count == 0 {
                return result + "\n| manual/unknown | unknown | unknown | unknown | unknown | unknown |"
            }

            for tool in J.Items(tools) {
                let declaration = ToolDeclaration.Parse(tool)
                let harness = RequestData.Identifier(declaration.Harness)
                let provider = RequestData.Identifier(declaration.Provider)
                let model = RequestData.ModelIdentifier(declaration.Model)
                let effort = RequestData.Identifier(declaration.Effort)

                result += "\n| " +
                    harness +
                    " / " +
                    provider +
                    " | " +
                    model +
                    " / " +
                    effort +
                    " | " +
                    (declaration.CodingSeconds != nil ? Duration(declaration.CodingSeconds ?? 0): "unknown") +
                    " | " +
                    Usage(declaration.Usage) +
                    " |"
            }

            return result
        }
    }
}

internal class UsageReport(inputTokens int64, cachedInputTokens int64, outputTokens int64) {
    internal let InputTokens int64 = inputTokens
    internal let CachedInputTokens int64 = cachedInputTokens
    internal let OutputTokens int64 = outputTokens

    shared {
        internal func Parse(value JsonElement) UsageReport {
            var input int64 = -1
            var cached int64 = -1
            var output int64 = -1

            if value.ValueKind == JsonValueKind.Object {
                for field in value.EnumerateObject() {
                    var count int64

                    if field.Value.ValueKind != JsonValueKind.Number || !field.Value.TryGetInt64(out count) ||
                        count < 0 {
                        count = -1
                    }

                    switch field.Name {
                        case "input_tokens" {
                            input = count
                        }
                        case "cached_input_tokens" {
                            cached = count
                        }
                        case "output_tokens" {
                            output = count
                        }
                    }
                }
            }

            return UsageReport(input, cached, output)
        }
    }
}
