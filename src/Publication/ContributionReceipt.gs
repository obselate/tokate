package Tokate

import System.Collections.Generic
import System.Text.Json

internal class ContributionReceipt {
    shared {
        internal func Coordinated(
            repo string,
            issue int32,
            approval string,
            expected string,
            reservation string,
            donor string,
            head string
        ) Dictionary[string, Object?] -> map[string, Object?]{
            "version": 2,
            "repo": repo,
            "issue": issue,
            "approval": approval,
            "expected": expected,
            "reservation": reservation,
            "donor": donor,
            "head": head
        }

        internal func Publication(
            repo string,
            issue int32,
            request JsonElement,
            reservation string,
            donor string
        ) Dictionary[string, Object?] {
            let declaration = CoordinatorRequest.Parse(request)
            let metadata = declaration.Metadata
            let publication = PublicationRequestMetadata.Parse(metadata)
            let receipt = Coordinated(
                repo,
                issue,
                declaration.Approval,
                declaration.Expected,
                reservation,
                donor,
                publication.Head
            )
            Models(receipt, publication)

            if publication.Correction.ValueKind != JsonValueKind.Undefined {
                receipt["correction"] = publication.Correction
            }

            if publication.Handoff.ValueKind != JsonValueKind.Undefined {
                receipt["handoff"] = publication.Handoff
            }

            if publication.HasIncomplete {
                receipt["incomplete"] = publication.Incomplete
            }

            AttemptContinuation.Keep(receipt, metadata)
            return receipt
        }

        internal func Models(fields Dictionary[string, Object?], metadata PublicationRequestMetadata) {
            if metadata.HasRequestedModel {
                fields["requested_model"] = metadata.RequestedModel
            }

            if metadata.HasReportedModel {
                fields["reported_model"] = metadata.ReportedModel
            }
        }

        internal func Models(fields Dictionary[string, Object?], value JsonElement) {
            for key in[]string{"requested_model", "reported_model"} {
                let model = J.Get(value, key)
                if model.ValueKind != JsonValueKind.Undefined {
                    fields[key] = model
                }
            }
        }

        internal func FromState(state JsonElement) JsonElement {
            let current = CoordinationState.Current(state)
            let original = J.Get(state, "contribution")
            let fields = Coordinated(
                J.Text(state, "repo"),
                J.Number(state, "issue"),
                J.Text(state, "approval_id"),
                J.Text(current, "expected"),
                J.Text(J.Get(state, "reservation"), "reservation"),
                J.Text(original, "donor"),
                J.Text(J.Get(current, "outcome"), "head")
            )
            let metadata = J.Get(original, "metadata")
            let publication = PublicationRequestMetadata.Parse(metadata)
            Models(fields, publication)
            let correction = publication.Correction
            let handoff = publication.Handoff

            if handoff.ValueKind != JsonValueKind.Undefined {
                fields["handoff"] = handoff
            }

            if J.Count(J.Get(state, "amendments")) == 0 && RequestMetadata.Incomplete(J.Get(original, "metadata")) {
                fields["incomplete"] = true
            }

            AttemptContinuation.Keep(fields, J.Get(original, "metadata"))

            if correction.ValueKind != JsonValueKind.Undefined {
                fields["correction"] = correction
            }

            if J.Count(J.Get(state, "amendments")) > 0 {
                let amended = map[string, Object?]{
                    "id": J.Text(current, "request"),
                    "previous": J.Text(current, "previous"),
                    "seconds": J.Number(current, "seconds"),
                    "tools": J.Get(current, "tools")
                }

                if J.Text(current, "base") != "" {
                    amended["base"] = J.Text(current, "base")
                }

                fields["amendment"] = PublicSummary.Attach(amended, J.Get(current, "summary"))
            }

            return J.Parse(J.Write(fields))
        }
    }
}
