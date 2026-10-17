package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class PrBody {
    shared {
        private const AmendmentVerification string = "Donor-reported: all original owner checks passed locally; coordinator did not observe execution."

        internal func Coordinated(
            record JsonElement,
            metadata JsonElement,
            donor string,
            receipt ContributionReceipt.Record,
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
            values["policy"] = OwnerApproval.Record.Parse(J.Get(record, "approval")).PolicyHash
            values["usage"] = "per-tool donor declaration; not independently attested"
            values["receipt"] = marker + "\n<!-- tokate-receipt:" + receipt.ToText() + " -->"

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
            values["pr_text"] = Policy.Parse(policy).PrText
            let text = template +
                (values["pr_text"] != "" && !template.Contains("{{pr_text}}") ? "\n\n{{pr_text}}\n": "")
            return Regex.Replace(text, "\\{\\{([a-z_]+)\\}\\}", (match Match) -> values[match.Groups[1].Value])
        }

        internal func PublicReport(metadata JsonElement, original JsonElement = default(JsonElement)) string {
            let declaration = ContributionReportData.Parse(metadata)
            let summary = declaration.Summary
            if summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(summary, declaration.Head)
            }

            let gratis = declaration.Mode == "gratis"
            let amendment = declaration.Previous != ""
            let verification = gratis ? "Tokate ran no repository checks. Checks below are donor-reported.":
            amendment ? AmendmentVerification:
            RequestMetadata.Incomplete(
                declaration.HasIncomplete,
                declaration.Incomplete
            ) ? "Incomplete draft: independent owner verification has not passed. This work is not ready for acceptance.":
            "Donor-reported: original owner checks passed locally on this candidate; coordinator did not observe execution."
            var report = PublicSummary.Report(summary, verification)
            if amendment {
                report += AmendmentReport(
                    declaration.Previous,
                    declaration.Head,
                    declaration.Seconds,
                    declaration.Tools
                )
            }
            let provenance = amendment ? original: metadata
            return report +
                (gratis || provenance.ValueKind == JsonValueKind.Undefined ? "": OriginalProvenance(provenance))
        }

        internal func PublicReport(amendment CoordinationState.PublicationRecord, original JsonElement) string {
            if amendment.Summary.ValueKind != JsonValueKind.Undefined {
                PublicSummary.Validate(amendment.Summary, amendment.Head)
            }

            return PublicSummary.Report(amendment.Summary, AmendmentVerification) +
                AmendmentReport(amendment.Previous, amendment.Head, amendment.Seconds, amendment.Tools) +
                (original.ValueKind == JsonValueKind.Undefined ? "": OriginalProvenance(original))
        }

        private func AmendmentReport(previous string, head string, seconds int32, tools JsonElement) string ->
        "\n\n- Review amendment: " + previous + " → " + head + "; separate " + seconds.ToString() +
            " second verification budget; no inference launched by amend.\n" +
            "- Original execution and usage cover original work only." +
            PublicSummary.Tools(tools, "Amendment donor-reported tools")

        internal func OriginalProvenance(metadata JsonElement) string {
            let publication = PublicationRequestMetadata.Parse(metadata)
            var report = "\n\n- Original source: " +
                (publication.SourceKind == "tokate" ? "managed Tokate": "external") +
                "; coding execution and usage are donor-reported to the coordinator." +
                PublicSummary.Tools(publication.Tools, "Original donor-reported tools")

            let correction = publication.Correction

            if correction.ValueKind != JsonValueKind.Undefined {
                let provenance = CorrectionRequestMetadata.Parse(correction)
                report += "\n\n- Correction: separate " + provenance.Seconds.ToString() +
                    " second verification budget; original declarations cover only the original completed turn." +
                    PublicSummary.Tools(provenance.Tools, "Donor-reported correction tools")
            }

            let prior = publication.Predecessor
            let handoff = publication.Handoff

            if let predecessor = ContributionHandoff.Declaration(handoff) {
                report += "\n\n- Supersedes #" + predecessor.Pr.ToString() +
                    " from @" +
                    predecessor.Donor +
                    ". Preserves the original commits from " +
                    predecessor.Head +
                    ". The repository owner may close the prior draft after reviewing this successor. Its discussion is preserved."
            }

            return report + (prior.ValueKind == JsonValueKind.Undefined ? "": "\n\n" + ContinuationReport(prior).Trim())
        }

        internal func ContinuationReport(prior JsonElement) string {
            let predecessor = ContinuationPredecessor.Parse(prior)

            return "Fresh attempt seeded from unpublished interrupted attempt " +
                predecessor.Attempt +
                " under predecessor approval " +
                predecessor.Approval +
                ". Preserved origin state: " +
                predecessor.State +
                "; failure: " +
                predecessor.FailureReason +
                ". Prior donor-reported tool: " +
                predecessor.Harness +
                "/" +
                predecessor.Provider +
                ", " +
                predecessor.Model +
                " / " +
                predecessor.Effort +
                ". The predecessor is not retroactively successful. Missing prior usage, reports and verification are not reconstructed. Usage and checks below describe the new attempt; all checks cover the complete final diff from the original approved base.\n\n"
        }

        internal func Receipt(body string) ContributionReceipt.Record -> ContributionReceipt.Record.Parse(
            RequestData.Parse(ReceiptText(body))
        )

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

        internal func Owned(body string) string -> ReportText(body) + "\n" + RequestData.Canonical(
            Receipt(body).ToJson()
        )

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
                "<!-- tokate-receipt:" + ContributionReceipt.Record.Parse(receipt).ToText() + " -->"
            )
        }
    }
}

internal class ContributionReportData(value JsonElement, seconds int32) {
    internal let Summary JsonElement = J.Get(value, "summary")
    internal let Head string = J.Get(value, "head").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Contribution report", "head"): ""
    internal let Mode string = J.Get(value, "mode").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Contribution report", "mode"): ""
    internal let Previous string = J.Get(value, "previous").ValueKind == JsonValueKind.String ?
    JsonFields.String(value, "Contribution report", "previous"): ""
    internal let Seconds int32 = seconds
    internal let Tools JsonElement = J.Get(value, "tools")
    internal let HasIncomplete bool = J.Get(value, "incomplete").ValueKind != JsonValueKind.Undefined
    internal let Incomplete bool = J.Get(value, "incomplete").ValueKind == JsonValueKind.True

    shared {
        internal func Parse(value JsonElement) ContributionReportData {
            let number = J.Get(value, "seconds")
            var seconds int32

            if number.ValueKind != JsonValueKind.Number || !number.TryGetInt32(out seconds) {
                seconds = 0
            }

            return ContributionReportData(value, seconds)
        }
    }
}
