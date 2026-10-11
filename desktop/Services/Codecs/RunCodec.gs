package TokateDesktop

import System
import System.Text.Json

class RunCodec {
    shared {
        func Run(data JsonElement, path string = "") Run {
            let tools = Json.Items(data, "tools")
            let found = Json.Text(data, "run")
            return Run{
                Path: found != "" ? found: path,
                Repo: Json.Text(data, "repo"),
                Issue: Json.Int(data, "issue"),
                State: Json.Text(data, "state"),
                FailureReason: Json.Text(data, "failure_reason"),
                ErrorMessage: Json.Text(Json.Get(data, "error"), "message"),
                Pr: Json.Int(data, "pr"),
                Harness: tools.Length > 0 ? Json.Text(tools[0], "harness"): Json.Text(data, "harness"),
                Model: Json.Text(data, "model"),
                Effort: Json.Text(data, "effort"),
                CodingSeconds: Json.Int(data, "coding_seconds"),
                VerificationReserve: Json.Int(data, "verification_reserve"),
                Seconds: Json.Int(data, "seconds"),
                Unlimited: Json.Bool(data, "unlimited"),
                Approval: Json.Text(data, "approval"),
                DonorId: Json.Text(data, "donor_id"),
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

        func ClaimId(runFile JsonElement) string {
            let request = Json.Text(Json.Get(runFile, "claim_request"), "uuid")
            if !Guid.TryParse(request, out var uuid) {
                throw Exception("Saved claim identity is missing.")
            }
            return request
        }
    }
}
