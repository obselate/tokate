package TokateDesktop

import System
import System.Collections.Generic
import System.Text.RegularExpressions

data struct SavedRun {
    var Path string
    var Run Run?
    var Actions []NextAction
    var Title string
    var PullRequest PullRequest?
    var RemoteError bool
    var Error string
    var Refreshed bool

    prop Loaded bool -> Run != nil

    prop Openable bool -> Run != nil && Error == ""

    func Identity(index int32) string -> Run != nil ? Run!!.Identity: "Saved contribution " + (index + 1).ToString()

    func Status() string {
        if Error != "" {
            return "Unavailable"
        }
        guard let run = Run else {
            return "Loading"
        }
        if RemoteError && run.Pr > 0 && PullRequest == nil {
            return "Review unavailable"
        }
        if let remote = PullRequest {
            if remote.Merged {
                return "Merged"
            }
            if remote.ChangesRequested {
                return "Needs amendment"
            }
            if remote.ChecksFailed {
                return "CI failed"
            }
            if remote.ChecksPending {
                return "CI pending"
            }
            if remote.Closed {
                return "Closed without merge"
            }
        }
        return switch run.State {
            case "claim_pending": "Awaiting reservation"
            case "claimed": "Claimed, not started"
            case "preparing": "Preparing workspace"
            case "running": "Donation in progress"
            case "failed": run.FailureReason == "verification_failed" ? "Verification failed": "Initial donation failed"
            case "generated": "Ready to submit"
            case "published": "Awaiting review"
            default: run.State.Replace('_', ' ')
        }
    }

    shared {
        func Pending(path string) SavedRun -> SavedRun{Path: path, Actions: []NextAction{}, Title: "", Error: ""}
    }
}

enum RunAction {
    Work,
    Prepare,
    Submit,
    Publish,
    Checks,
    Recover,
    Amend,
    Reconcile
}

class RunActions {
    shared {
        func Command(action RunAction) string -> switch action {
            case RunAction.Work: "work"
            case RunAction.Prepare: "prepare"
            case RunAction.Submit: "submit"
            case RunAction.Publish: "publish"
            case RunAction.Checks: "checks"
            case RunAction.Recover: "recover"
            case RunAction.Amend: "amend"
            default: "reconcile"
        }

        func Parse(command string) RunAction? -> switch command {
            case "work": RunAction.Work
            case "prepare": RunAction.Prepare
            case "submit": RunAction.Submit
            case "publish": RunAction.Publish
            case "checks": RunAction.Checks
            case "recover": RunAction.Recover
            default: nil
        }

        func From(actions []NextAction, state string) []RunAction {
            let result = List[RunAction]()
            for action in actions {
                if action.Arguments.Length < 2 {
                    continue
                }
                if let parsed = Parse(action.Command) {
                    if !result.Contains(parsed) {
                        result.Add(parsed)
                    }
                }
            }
            if state == "claim_pending" && !result.Contains(RunAction.Prepare) {
                result.Add(RunAction.Prepare)
            }
            return result.ToArray()
        }

        func ButtonLabel(action RunAction) string -> switch action {
            case RunAction.Work: "Start donation"
            case RunAction.Prepare: "Check reservation"
            case RunAction.Submit: "Submit draft PR"
            case RunAction.Publish: "Publish draft PR"
            case RunAction.Checks: "Check PR and CI"
            default: "Run verification again"
        }

        func Primary(action RunAction) bool -> action == RunAction.Work || action == RunAction.Submit

        func DialogTitle(action RunAction) string -> switch action {
            case RunAction.Amend: "Publish amendment"
            case RunAction.Recover: "Run verification"
            case RunAction.Reconcile: "Update workspace"
            case RunAction.Checks: "Check pull request"
            default: "Continue contribution"
        }

        func DialogDetail(action RunAction) string -> switch action {
            case RunAction.Amend: "Publish verified changes to GitHub. The owner reviews and merges."
            case RunAction.Submit: "Publish verified changes to GitHub. The owner reviews and merges."
            case RunAction.Publish: "Publish verified changes to GitHub. The owner reviews and merges."
            case RunAction.Reconcile: "Merge the current target into this saved workspace."
            case RunAction.Recover: "Run project verification without inference."
            default: "Inspect and continue this contribution."
        }

        func NeedsBudget(action RunAction) bool -> action == RunAction.Recover || action == RunAction.Amend
    }
}

data struct AmendmentDraft {
    var Open bool
    var Commit string
    var Summary string
    var Tools string
    var Verification string

    func VerificationMinutes() int32 {
        if !int32.TryParse(Verification, out var minutes) || minutes < 1 || minutes > 1440 {
            throw Exception("Enter 1 to 1440 verification minutes.")
        }
        return minutes
    }

    func ValidCommit() string {
        if Commit.Length != 40 || !Regex.IsMatch(Commit, "^[a-fA-F0-9]{40}$") {
            throw Exception("Enter the complete 40-character commit.")
        }
        return Commit
    }

    shared {
        let Initial AmendmentDraft = AmendmentDraft{Commit: "", Summary: "", Tools: "", Verification: "30"}
    }
}

/// Everything the saved work page shows: the discovered runs, the visible page, and the selected run with
/// its actions and amendment settings.
data struct SavedWorkState {
    var Loaded bool
    var Importing bool
    var Selected bool
    var Reading bool
    var Page int32
    var Paths []string
    var Rows []SavedRun
    var RunPath string
    var Run Run
    var Actions []RunAction
    var Amendment AmendmentDraft

    prop Browsing bool -> Loaded && !Selected && !Importing

    prop LastPage int32 -> IssueListing.LastPage(Paths.Length)

    shared {
        let Initial SavedWorkState = SavedWorkState{
            Page: 1,
            Paths: []string{},
            Rows: []SavedRun{},
            RunPath: "",
            Run: Run.Empty,
            Actions: []RunAction{},
            Amendment: AmendmentDraft.Initial,
        }
    }
}
