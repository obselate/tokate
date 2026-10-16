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
            let metadata = J.Get(request, "metadata")
            let receipt = Coordinated(
                repo,
                issue,
                J.Text(request, "approval"),
                J.Text(request, "expected"),
                reservation,
                donor,
                J.Text(metadata, "head")
            )
            Models(receipt, metadata)
            for field in[]string{"correction", "handoff", "incomplete"} {
                let value = J.Get(metadata, field)
                if value.ValueKind != JsonValueKind.Undefined {
                    receipt[field] = value
                }
            }
            AttemptContinuation.Keep(receipt, metadata)
            return receipt
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
            Models(fields, J.Get(original, "metadata"))
            let correction = J.Get(J.Get(original, "metadata"), "correction")
            let handoff = J.Get(J.Get(original, "metadata"), "handoff")

            if handoff.ValueKind != JsonValueKind.Undefined {
                fields["handoff"] = handoff
            }

            if J.Count(J.Get(state, "amendments")) == 0 && RequestData.Incomplete(J.Get(original, "metadata")) {
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
