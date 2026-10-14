package TokateDesktop

import System
import System.Text.Json

class RunCodec {
    shared {
        func Run(data JsonElement, path string = "") Run {
            let tools = Json.Items(data, "tools")
            let found = Json.Text(data, "run")
            let correction = Json.Get(data, "correction")
            let amendment = Json.Get(data, "amendment")
            let finish = Json.Strings(Json.Get(data, "next"), "command")
            return Run{
                Path: found != "" ? found: path,
                Repo: Json.Text(data, "repo"),
                Issue: Json.Int(data, "issue"),
                State: Json.Text(data, "state"),
                FailureReason: Json.Text(data, "failure_reason"),
                ErrorMessage: Json.Text(Json.Get(data, "error"), "message"),
                Pr: Json.Int(data, "pr"),
                Harness: tools.Length > 0 ? Json.Text(tools[0], "harness"): Json.Text(data, "harness"),
                Provider: tools.Length > 0 ? Json.Text(tools[0], "provider"): "",
                Model: Json.Text(data, "model"),
                Effort: Json.Text(data, "effort"),
                CodingSeconds: Json.Int(data, "coding_seconds"),
                VerificationReserve: Json.Int(data, "verification_reserve"),
                Seconds: Json.Int(data, "seconds"),
                Unlimited: Json.Bool(data, "unlimited"),
                Approval: Json.Text(data, "approval"),
                DonorId: Json.Text(data, "donor_id"),
                Commit: Json.Text(data, "commit"),
                Checkout: Json.Text(Json.Get(data, "artifacts"), "checkout"),
                External: Json.Text(data, "source") == "external",
                Amending: Json.Text(amendment, "state") == "requested" ? Json.Text(amendment, "commit"):
                Json.Text(correction, "state") == "verified" && finish.Length > 1 && finish[1] == "amend" ? Json.Text(correction, "commit"): "",
                Finish: finish,
                Guidance: Json.Text(Json.Get(data, "next"), "action"),
                Warning: "",
            }
        }

        /// The public summary in a saved run file. A run without one gives empty lists.
        func Summary(runFile JsonElement) PublicSummary {
            let summary = Json.Get(runFile, "public_summary")
            return PublicSummary{
                Changes: Json.Strings(summary, "changes"),
                Verification: Json.Strings(summary, "verification"),
                Limitations: Json.Strings(summary, "limitations"),
            }
        }

        /// Decodes a run, falling back to `path` when the data does not name its directory.
        func Reader(path string) Func[JsonElement, Run] -> (data JsonElement) -> Run(data, path)

        func Reservation(state JsonElement) Reservation {
            let reservation = Json.Get(state, "reservation")
            return Reservation{
                ApprovalId: Json.Text(state, "approval_id"),
                Revoked: Json.BoolOrNil(state, "revoked"),
                Lease: Json.Text(reservation, "lease"),
                Attempt: Json.Text(reservation, "attempt"),
                Actor: Json.Text(reservation, "actor"),
                Status: Json.Text(reservation, "status"),
                Expires: Json.Long(reservation, "expires"),
            }
        }

        /// The head commit of the contribution in the coordination state, or "" before publication.
        func ContributionHead(state JsonElement) string -> Json.Text(Json.Get(state, "contribution"), "head")

        func AmendmentFailure(record JsonElement) string -> Json.Text(record, "state") == "failed" ?
        AmendmentFailures.Explain(Json.Text(record, "failure_reason"), Json.Text(record, "error")): ""

        func ClaimId(runFile JsonElement) string {
            let request = Json.Text(Json.Get(runFile, "claim_request"), "uuid")
            if !Guid.TryParse(request, out var uuid) {
                throw Exception("Saved claim identity is missing.")
            }
            return request
        }
    }
}
