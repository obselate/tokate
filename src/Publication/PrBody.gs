package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class PrBody {
    shared {
        internal func Coordinated(
            record JsonElement,
            metadata JsonElement,
            donor string,
            receipt Object,
            marker string
        ) string {
            let values = Dictionary[string, string]()
            values["issue"] = J.Number(J.Get(record, "issue"), "number").ToString()
            values["report"] = PrBody.Report(PrBody.PublicReport(metadata))
            values["donor"] = donor
            values["model"] = "see original donor-reported tools in report"
            values["effort"] = "per-tool declaration; not independently attested"
            values["seconds"] = "donor-reported or unknown; reservation is not a compute budget"
            values["base"] = J.Text(record, "base")
            values["policy"] = J.Text(J.Get(record, "approval"), "policy_hash")
            values["usage"] = "per-tool donor declaration; not independently attested"
            values["receipt"] = marker + "\n<!-- tokate-receipt:" + J.Write(receipt) + " -->"

            return PrBody.Render(J.Text(record, "template"), values, J.Get(record, "policy"))
        }

        internal func ValidateTemplate(text string) {
            for key in[]string{"issue", "report", "donor", "base", "policy", "receipt"} {
                if !text.Contains("{{" + key + "}}") {
                    throw CliFailure("invalid_state", "PR template must contain {{" + key + "}}")
                }
            }
        }

        internal func Template(repo string, revision string) string {
            try {
                let custom = GitHub.Api(
                    "repos/" + repo + "/contents/.github/tokate-pr.md?ref=" + Uri.EscapeDataString(revision),
                    missing: true
                )
                var text = ApplicationInfo.Resource("tokate-pr.md")

                if custom.ValueKind != JsonValueKind.Undefined {
                    if J.Text(custom, "encoding") != "base64" {
                        throw CliFailure("invalid_state", "Expected a small repository PR template")
                    }

                    text = Encoding.UTF8.GetString(Convert.FromBase64String(J.Text(custom, "content")))

                    ValidateTemplate(text)
                }

                return text
            } catch (error FormatException) {
                throw CliFailure("invalid_state", error.Message, summary: CliFailure.Message("invalid_state"))
            }
        }

        internal func Render(template string, values Dictionary[string, string], policy JsonElement) string {
            values["pr_text"] = J.Text(policy, "pr_text")
            let text = template +
                (values["pr_text"] != "" && !template.Contains("{{pr_text}}") ? "\n\n{{pr_text}}\n": "")
            return Regex.Replace(text, "\\{\\{([a-z_]+)\\}\\}", (match Match) -> values[match.Groups[1].Value])
        }

        internal func PublicReport(metadata JsonElement, original JsonElement = default(JsonElement)) string {
            let summary = J.Get(metadata, "summary")
            if summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(summary, J.Text(metadata, "head"))
            }

            let gratis = J.Text(metadata, "mode") == "gratis"
            let amendment = J.Text(metadata, "previous") != ""
            let verification = gratis ? "Tokate ran no repository checks. Checks below are donor-reported.":
            amendment ? "Donor-reported: all original owner checks passed locally; coordinator did not observe execution.":
            RequestData.Incomplete(
                metadata
            ) ? "Incomplete draft: independent owner verification has not passed. This work is not ready for acceptance.":
            "Donor-reported: original owner checks passed locally on this candidate; coordinator did not observe execution."
            var report = PublicSummary.Report(summary, verification)
            if amendment {
                report += "\n\n- Review amendment: " + J.Text(metadata, "previous") + " → " + J.Text(metadata, "head") +
                    "; separate " +
                    J
                    .Number(metadata, "seconds").ToString() +
                    " second verification budget; no inference launched by amend.\n" +
                    "- Original execution and usage cover original work only." +
                    PublicSummary.Tools(J.Get(metadata, "tools"), "Amendment donor-reported tools")
            }
            let provenance = amendment ? original: metadata
            return report +
                (gratis || provenance.ValueKind == JsonValueKind.Undefined ? "": OriginalProvenance(provenance))
        }

        internal func OriginalProvenance(metadata JsonElement) string {
            var report = "\n\n- Original source: " +
                (J.Text(metadata, "source") == "tokate" ? "managed Tokate": "external") +
                "; coding execution and usage are donor-reported to the coordinator." +
                PublicSummary.Tools(J.Get(metadata, "tools"), "Original donor-reported tools")

            let correction = J.Get(metadata, "correction")

            if correction.ValueKind != JsonValueKind.Undefined {
                report += "\n\n- Correction: separate " + J.Number(correction, "seconds").ToString() +
                    " second verification budget; original declarations cover only the original completed turn." +
                    PublicSummary.Tools(J.Get(correction, "tools"), "Donor-reported correction tools")
            }

            let prior = J.Get(metadata, "predecessor")
            let handoff = J.Get(metadata, "handoff")

            if handoff.ValueKind != JsonValueKind.Undefined {
                ContributionHandoff.Declaration(handoff)

                report += "\n\n- Supersedes #" + J.Number(handoff, "pr").ToString() + " from @" + J.Text(
                    handoff,
                    "donor"
                ) +
                    ". Preserves the original commits from " +
                    J.Text(handoff, "head") +
                    ". The repository owner may close the prior draft after reviewing this successor. Its discussion is preserved."
            }

            return report + (prior.ValueKind == JsonValueKind.Undefined ? "": "\n\n" + ContinuationReport(prior).Trim())
        }

        internal func ContinuationReport(
            prior JsonElement
        ) string -> "Fresh attempt seeded from unpublished interrupted attempt " +
            J.Text(prior, "attempt") + " under predecessor approval " + J.Text(prior, "approval") +
            ". Preserved origin state: " +
            J.Text(prior, "state") + "; failure: " + J.Text(prior, "failure_reason") +
            ". Prior donor-reported tool: " +
            J.Text(prior, "harness") + "/" + J.Text(prior, "provider") + ", " + J.Text(prior, "model") + " / " + J.Text(
            prior,
            "effort"
        ) +
            ". The predecessor is not retroactively successful. Missing prior usage, reports and verification are not reconstructed. Usage and checks below describe the new attempt; all checks cover the complete final diff from the original approved base.\n\n"

        internal func Receipt(body string) JsonElement -> RequestData.Parse(ReceiptText(body))

        internal func ReceiptText(
            body string,
            ambiguity string = "Missing or ambiguous Tokate-owned report/receipt region",
            malformed string = "Malformed Tokate receipt"
        ) string {
            let prefix = "<!-- tokate-receipt:"
            let start = Unique(body, prefix, ambiguity)
            let end = body.IndexOf(" -->", start, StringComparison.Ordinal)

            if end < 0 {
                throw CliFailure("invalid_state", malformed)
            }

            return body.Substring(start + prefix.Length, end - start - prefix.Length)
        }

        private func Unique(
            body string,
            value string,
            failure string = "Missing or ambiguous Tokate-owned report/receipt region"
        ) int32 {
            let start = body.IndexOf(value, StringComparison.Ordinal)

            if start < 0 || body.IndexOf(value, start + value.Length, StringComparison.Ordinal) >= 0 {
                throw CliFailure("invalid_state", failure)
            }

            return start
        }

        internal func Report(text string) string -> "<!-- tokate-report:start -->\n" +
            text +
            "\n<!-- tokate-report:end -->"

        internal func ReportText(body string) string {
            let prefix = "<!-- tokate-report:start -->"
            let suffix = "<!-- tokate-report:end -->"
            let start = Unique(body, prefix) + prefix.Length
            let end = Unique(body, suffix)

            if end < start {
                throw CliFailure("invalid_state", "Malformed Tokate report region")
            }

            return body.Substring(start, end - start).Trim()
        }

        internal func Owned(body string) string -> ReportText(body) + "\n" + RequestData.Canonical(Receipt(body))

        internal func ReplaceBody(body string, report string, receipt JsonElement) string {
            let prefix = "<!-- tokate-report:start -->"
            let suffix = "<!-- tokate-report:end -->"
            let start = Unique(body, prefix)
            let end = Unique(body, suffix)

            if end <= start {
                throw CliFailure("invalid_state", "Malformed Tokate report region")
            }

            let length = end + suffix.Length - start
            let updated = body.Remove(start, length).Insert(start, Report(report))
            let receiptStart = Unique(updated, "<!-- tokate-receipt:")
            let receiptEnd = updated.IndexOf(" -->", receiptStart, StringComparison.Ordinal)

            if receiptEnd < 0 {
                throw CliFailure("invalid_state", "Malformed Tokate receipt")
            }

            return updated.Remove(receiptStart, receiptEnd + 4 - receiptStart).Insert(
                receiptStart,
                "<!-- tokate-receipt:" + J.Write(receipt) + " -->"
            )
        }
    }
}
