package TokateDesktop

import System

enum RunState {
    Unknown,
    ClaimPending,
    Requested,
    ApprovalWaiting,
    Preparing,
    Claimed,
    Running,
    Verifying,
    Generated,
    IncompleteGenerated,
    Verified,
    Publishing,
    Published,
    Completed,
    Failed,
    Interrupted,
    Unavailable,
    StaleRemoteData
}

data struct Run {
    var Path string
    var Repo string
    var Issue int32
    var State string
    var FailureReason string
    var ErrorMessage string
    var Pr int32
    var Harness string
    var Model string
    var Effort string
    var CodingSeconds int32
    var VerificationReserve int32
    var Seconds int32
    var Unlimited bool
    var Network bool
    var Approval string
    var DonorId string

    prop Kind RunState -> Run.Parse(State)

    prop Identity string -> Repo + " #" + Issue.ToString()

    prop Readable bool -> Repo != "" && Issue >= 1

    prop CodingTime string -> Unlimited ? "Unlimited": (CodingSeconds / 60).ToString() + " minutes"

    prop VerificationTime string -> (VerificationReserve / 60).ToString() + " minutes"

    shared {
        func Parse(state string) RunState -> switch state {
            case "claim_pending": RunState.ClaimPending
            case "requested": RunState.Requested
            case "approval_waiting": RunState.ApprovalWaiting
            case "preparing": RunState.Preparing
            case "claimed": RunState.Claimed
            case "running": RunState.Running
            case "verifying": RunState.Verifying
            case "generated": RunState.Generated
            case "incomplete_generated": RunState.IncompleteGenerated
            case "verified": RunState.Verified
            case "publishing": RunState.Publishing
            case "published": RunState.Published
            case "completed": RunState.Completed
            case "failed": RunState.Failed
            case "interrupted": RunState.Interrupted
            case "unavailable": RunState.Unavailable
            case "stale_remote_data": RunState.StaleRemoteData
            default: RunState.Unknown
        }

        let Empty Run = Run{
            Path: "",
            Repo: "",
            State: "",
            FailureReason: "",
            ErrorMessage: "",
            Harness: "",
            Model: "",
            Effort: "",
            Approval: "",
            DonorId: "",
        }
    }
}

data struct Reservation {
    var ApprovalId string
    var Revoked bool?
    var Lease string
    var Attempt string
    var Actor string
    var Status string
    var Expires int64?

    func IsReadyFor(run Run, claimId string, now int64) bool ->
    ApprovalId == run.Approval &&
        Revoked == false &&
        Lease == claimId &&
        Attempt == claimId &&
        Actor == run.DonorId &&
        Status == "active" &&
        Expires != nil &&
        Expires!! > now
}
