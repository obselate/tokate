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

    prop Merged bool -> State == "MERGED"

    prop Closed bool -> State == "CLOSED"

    prop ChangesRequested bool -> ReviewDecision == "CHANGES_REQUESTED"

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
