package TokateDesktop

import System

data struct CheckRun {
    var Status string
    var Conclusion string
    var State string

    prop Failed bool -> Conclusion == "FAILURE" || Conclusion == "TIMED_OUT" || State == "FAILURE"

    prop Pending bool -> Status == "IN_PROGRESS" || Status == "QUEUED" || State == "PENDING"
}

data struct PullRequest {
    var State string
    var ReviewDecision string
    var Checks []CheckRun
    var Url string
    var Conflicts bool

    prop Merged bool -> State == "MERGED"

    prop Closed bool -> State == "CLOSED"

    prop ChangesRequested bool -> ReviewDecision == "CHANGES_REQUESTED"

    /// The donor's name for the review state.
    prop Review string -> Merged ? "Merged": Closed ? "Closed": ChangesRequested ? "Changes requested": ReviewDecision == "APPROVED" ?
    "Approved": "Review pending"

    /// How many checks failed, are pending or passed. Empty when the pull request has no checks.
    prop ChecksSummary string {
        get {
            var failed = 0
            var pending = 0
            for check in Checks {
                if check.Failed {
                    failed++
                } else if check.Pending {
                    pending++
                }
            }
            let total = Checks.Length.ToString()
            return Checks.Length == 0 ? "": failed > 0 ? failed.ToString() + " of " + total + " failed": pending > 0 ?
            pending.ToString() + " of " + total + " pending": total + " of " + total + " passed"
        }
    }

    prop ChecksFailed bool {
        get {
            for check in Checks {
                if check.Failed {
                    return true
                }
            }
            return false
        }
    }

    prop ChecksPending bool {
        get {
            for check in Checks {
                if check.Pending {
                    return true
                }
            }
            return false
        }
    }
}
