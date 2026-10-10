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
            }
        }

        func ChecksStatus(data JsonElement) string -> Json.Text(data, "checks_status")
    }
}
