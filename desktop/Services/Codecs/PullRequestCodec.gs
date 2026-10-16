package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class PullRequestCodec {
    shared {
        func PullRequest(value JsonElement) PullRequest {
            let checks = List[CheckRun]()
            for check in Json.Items(value, "statusCheckRollup") {
                checks.Add(
                    CheckRun{
                        Status: Json.Text(check, "status"),
                        Conclusion: Json.Text(check, "conclusion"),
                        State: Json.Text(check, "state")
                    }
                )
            }
            return PullRequest{
                State: Json.Text(value, "state"),
                ReviewDecision: Json.Text(value, "reviewDecision"),
                Checks: checks.ToArray(),
                Url: Json.Text(value, "url"),
                Conflicts: Json.Text(value, "mergeable") == "CONFLICTING",
            }
        }

        /// The CI state of a pull request. Workflow runs that wait for the approval of the owner come first,
        /// because the checks cannot finish before the owner approves them.
        func ChecksStatus(data JsonElement) string -> Json.Items(data, "workflow_runs_awaiting_approval").Length > 0 ?
        DraftReview.NeedsApproval: Json.Text(data, "machine_status") == "historical" ? "historical": Json.Text(data, "checks_status")

        func Review(data JsonElement) DraftReview {
            let receipt = Json.Text(Json.Get(Json.Get(data, "gates"), "receipt"), "status")
            return DraftReview{
                Receipt: receipt == "passed" ? "verified": receipt,
                Ci: ChecksStatus(data).Replace('_', ' '),
                NeedsAmendment: Json.Get(data, "mergeable").ValueKind == JsonValueKind.False,
            }
        }
    }
}
