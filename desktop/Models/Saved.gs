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
    var Changed DateTime

    prop Loaded bool -> Run != nil

    prop Openable bool -> Run != nil && Error == ""

    func Identity(index int32) string -> Run != nil ? Run!!.Identity: "Saved contribution " + (index + 1).ToString()

    /// How long before `now` the run directory last changed. Empty when the time is not known.
    func Age(now DateTime) string {
        if Changed == DateTime.MinValue {
            return ""
        }
        let span = now - Changed
        if span.TotalMinutes < 1 {
            return "Now"
        }
        if span.TotalHours < 1 {
            return Count(int32(span.TotalMinutes), "minute")
        }
        if span.TotalDays < 1 {
            return Count(int32(span.TotalHours), "hour")
        }
        return span.TotalDays < 30 ? Count(int32(span.TotalDays), "day"): Changed.ToLocalTime().ToString("d MMM yyyy")
    }

    private func Count(number int32, unit string) string -> number.ToString() + " " + unit + (number == 1 ? "": "s") + " ago"

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
        return run.Status
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
            case RunAction.Amend: "Amend contribution"
            case RunAction.Reconcile: "Update workspace"
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

/// What a status means for the donor: the step the contribution is at, who acts next and the main action.
data struct RunGuide {
    var Step int32
    var Heading string
    var Text string
    var Main RunAction?

    shared {
        let Steps []string = []string{"Reserve", "Donate", "Submit", "Review", "Merge"}

        /// The guide for a status label. `submitted` places a status that is not listed.
        func For(status string, submitted bool) RunGuide -> switch status {
            case "Awaiting reservation": RunGuide{
                Step: 0,
                Heading: "Waiting for approval",
                Text: "The coordinator must accept this reservation.",
                Main: RunAction.Prepare,
            }
            case "Claimed, not started": RunGuide{
                Step: 1,
                Heading: "The reservation is approved",
                Text: "Start the donation. The time starts then.",
                Main: RunAction.Work,
            }
            case "Preparing workspace": RunGuide{Step: 1, Heading: "Tokate prepares the workspace", Text: ""}
            case "Donation in progress": RunGuide{Step: 1, Heading: "A donation runs for this contribution", Text: ""}
            case "Initial donation failed": RunGuide{
                Step: 1,
                Heading: "The donation failed",
                Text: "Start the donation again.",
                Main: RunAction.Work,
            }
            case "Verification failed": RunGuide{
                Step: 1,
                Heading: "Verification failed",
                Text: "Correct the work in the run directory. Then run the verification again. No inference runs.",
                Main: RunAction.Recover,
            }
            case "Ready to submit": RunGuide{
                Step: 2,
                Heading: "The work is ready to submit",
                Text: "Verification passed. Submit the work as a draft pull request. The owner reviews and merges.",
                Main: RunAction.Submit,
            }
            case "Awaiting review": RunGuide{
                Step: 3,
                Heading: "The owner reviews the pull request",
                Text: "No action is necessary. The owner decides acceptance and merge.",
            }
            case "CI pending": RunGuide{Step: 3, Heading: "The checks run on the pull request", Text: "No action is necessary."}
            case "CI failed": RunGuide{
                Step: 3,
                Heading: "A check failed on the pull request",
                Text: "Correct the work in the run directory and commit it. Then publish an amendment.",
                Main: RunAction.Amend,
            }
            case "Needs amendment": RunGuide{
                Step: 3,
                Heading: "The owner requested changes",
                Text: "Make the changes in the run directory and commit them. Then publish the amendment.",
                Main: RunAction.Amend,
            }
            case "Closed without merge": RunGuide{
                Step: 3,
                Heading: "The owner closed the pull request",
                Text: "The pull request was not merged.",
            }
            case "Review unavailable": RunGuide{
                Step: 3,
                Heading: "GitHub did not return the pull request",
                Text: "Refresh the status.",
            }
            case "Merged": RunGuide{Step: 5, Heading: "The owner merged this contribution", Text: ""}
            default: RunGuide{
                Step: submitted ? 3: 1,
                Heading: status == "" ? "": status.Substring(0, 1).ToUpperInvariant() + status.Substring(1),
                Text: "",
            }
        }
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
    var Chosen SavedRun
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
            Chosen: SavedRun.Pending(""),
            Run: Run.Empty,
            Actions: []RunAction{},
            Amendment: AmendmentDraft.Initial,
        }
    }
}
