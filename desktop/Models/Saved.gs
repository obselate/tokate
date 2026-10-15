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
    Claim,
    Submit,
    Checks,
    Amend,
    Reconcile
}

class RunActions {
    shared {
        func Command(action RunAction) string -> switch action {
            case RunAction.Work: "work"
            case RunAction.Claim: "claim"
            case RunAction.Submit: "submit"
            case RunAction.Checks: "checks"
            case RunAction.Amend: "amend"
            default: "reconcile"
        }

        func Parse(command string) RunAction? -> switch command {
            case "work": RunAction.Work
            case "claim": RunAction.Claim
            case "submit": RunAction.Submit
            case "checks": RunAction.Checks
            case "amend": RunAction.Amend
            default: nil
        }

        func From(actions []NextAction, state string) []RunAction {
            let result = List[RunAction]()
            for action in actions {
                if action.Arguments.Length < 3 || action.Arguments[0] != "tokate" {
                    continue
                }
                if let parsed = Parse(action.Command) {
                    if Array.IndexOf(action.Arguments, "--continue-from") >= 0 {
                        continue
                    }
                    if !result.Contains(parsed) {
                        result.Add(parsed)
                    }
                }
            }
            if state == "claim_pending" && !result.Contains(RunAction.Claim) && !result.Contains(RunAction.Work) {
                result.Add(RunAction.Claim)
            }
            return result.ToArray()
        }

        func ButtonLabel(action RunAction) string -> switch action {
            case RunAction.Work: "Start donation"
            case RunAction.Claim: "Check reservation"
            case RunAction.Submit: "Submit draft PR"
            case RunAction.Checks: "Check PR and CI"
            case RunAction.Amend: "Amend contribution"
            case RunAction.Reconcile: "Update workspace"
            default: "Run verification again"
        }

        func Primary(action RunAction) bool -> action == RunAction.Work || action == RunAction.Submit

        func DialogTitle(action RunAction) string -> switch action {
            case RunAction.Amend: "Publish amendment"
            case RunAction.Reconcile: "Update workspace"
            case RunAction.Checks: "Check pull request"
            default: "Continue contribution"
        }

        func DialogDetail(action RunAction) string -> switch action {
            case RunAction.Amend: "Publish verified changes to GitHub. The owner reviews and merges."
            case RunAction.Submit: "Publish verified changes to GitHub. The owner reviews and merges."
            case RunAction.Reconcile: "Merge the current target into this saved workspace."
            default: "Inspect and continue this contribution."
        }

        func NeedsBudget(action RunAction) bool -> action == RunAction.Amend

        /// True when the command only sends a request, and the same command saves the result later.
        func Requests(action RunAction) bool -> action == RunAction.Submit || action == RunAction.Amend

        func Requested(action RunAction) string -> action == RunAction.Amend ?
        "Amendment sent. Waiting for the coordinator.":
        "Request sent. The coordinator is opening the draft pull request."

        func Recorded(action RunAction) string -> action == RunAction.Amend ? "The pull request has the amendment.": ""
    }
}

/// A request that the coordinator must record before its action is complete. `Head` is the commit that
/// the contribution then has. `Arguments` repeat the command, which then saves the result. `Files` is
/// the private directory of the amendment files, or "".
data struct CoordinatorRequest {
    var Action RunAction
    var Path string
    var Repo string
    var Issue int32
    var Head string
    var Arguments []string
    var Seconds int32
    var Files string
    var Since DateTime
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
                Main: RunAction.Claim,
            }
            case "Claimed, not started": RunGuide{
                Step: 1,
                Heading: "The reservation is approved",
                Text: "Start the donation. The time starts then.",
                Main: RunAction.Work,
            }
            case "Preparing workspace": RunGuide{
                Step: 1,
                Heading: "Tokate prepares the workspace",
                Text: "No action is necessary. Refresh the status to see the result.",
            }
            case "Donation in progress": RunGuide{
                Step: 1,
                Heading: "A donation runs for this contribution",
                Text: "No action is necessary. Refresh the status to see the result.",
            }
            case "Initial donation failed": RunGuide{
                Step: 1,
                Heading: "The donation failed",
                Text: "Keep the saved work. Check the failure before starting another attempt with a new budget.",
            }
            case "Verification failed": RunGuide{
                Step: 1,
                Heading: "Verification failed",
                Text: "Select Amend contribution to preserve original evidence before editing. Then commit the changes and verify the amendment. No inference runs.",
                Main: RunAction.Amend,
            }
            case "Ready to submit": RunGuide{
                Step: 2,
                Heading: "The work is ready to submit",
                Text: "Verification passed. Review the pull request before publication.",
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

/// The commit at HEAD of a saved checkout and the number of files that it changes since the published
/// commit. An empty commit means that the checkout has no correction to publish.
data struct CheckoutHead {
    var Commit string
    var Subject string
    var Files int32
}

/// The public summary of a contribution, as the short lines that the pull request shows.
data struct PublicSummary {
    var Changes []string
    var Verification []string
    var Limitations []string

    /// The summary without empty lines and outer spaces. Throws when Tokate would reject it.
    func Valid() PublicSummary {
        let summary = PublicSummary{
            Changes: PublicSummary.Filled(Changes),
            Verification: PublicSummary.Filled(Verification),
            Limitations: PublicSummary.Filled(Limitations),
        }
        if summary.Changes.Length == 0 {
            throw Exception("Add at least one change to the summary.")
        }
        for lines in [][]string{summary.Changes, summary.Verification, summary.Limitations} {
            for line in lines {
                if PublicSummary.Problem(line) != "" {
                    throw Exception("Correct the marked summary lines first.")
                }
            }
        }
        return summary
    }

    shared {
        let Empty PublicSummary = PublicSummary{Changes: []string{}, Verification: []string{}, Limitations: []string{}}

        /// Why Tokate rejects `line` as public text, or an empty string. An empty line has no problem because
        /// it is left out.
        func Problem(line string) string {
            let text = line.Trim()
            if text == "" {
                return ""
            }
            if text.Length < 3 || text.Length > 200 {
                return "Use 3 to 200 characters."
            }
            if !Regex.IsMatch(text, "^[A-Za-z0-9 .,;:!?()'+_=-]+$") {
                return "Use only letters, numbers, spaces and . , ; : ! ? ( ) ' + _ = -"
            }
            if Regex.IsMatch(
                text,
                "(?i)(https?:|www\\.|\\b[A-Z]:|gh[pousr]_|github_pat_|sk-|bearer|password|api[ _-]?key|credential|secret|tokate-receipt|tokate-report|localhost:|[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+|[a-z]+://|generated a patch|implemented acceptance criteria)"
            ) {
                return "Tokate rejects this text. Remove links, addresses and words such as password, secret or key."
            }
            return ""
        }

        private func Filled(lines []string) []string {
            let result = List[string]()
            for line in lines {
                if line.Trim() != "" {
                    result.Add(line.Trim())
                }
            }
            return result.ToArray()
        }
    }
}

class AmendmentFailures {
    shared {
        /// Words for the donor about a failed amendment, from the reason and error text that Tokate saved.
        /// "" when the saved record says no more than the command did.
        func Explain(reason string, error string) string {
            if reason != "candidate_changed" {
                return ""
            }
            let files = List[string]()
            for line in error.Split('\n') {
                let at = line.LastIndexOf(" b/")
                if line.Contains("diff --git a/") && at > 0 {
                    files.Add(line.Substring(at + 3))
                }
            }
            return "The verification commands changed files that the commit tracks" +
                (files.Count > 0 ? ": " + String.Join(", ", files): "") +
                ". Remove generated files from the commit, then publish again."
        }
    }
}

/// Who made the correction that an amendment publishes.
enum EditedBy {
    Hand,
    Donation,
    Other
}

/// An amendment publishes the commit at HEAD of the saved checkout, which the form reads when it opens.
/// Tokate rejects a commit that changes no files, so the form reads a commit only when files changed.
/// `Checked` is false while the checkout is read. `Tools` is the declarations file for other tools.
data struct AmendmentDraft {
    var Open bool
    var Checked bool
    var Commit string
    var Subject string
    var Files int32
    var Summary PublicSummary
    var Edited EditedBy
    var Tools string
    var Verification string

    func VerificationMinutes() int32 {
        if !int32.TryParse(Verification, out var minutes) || minutes < 1 || minutes > 1440 {
            throw Exception("Enter 1 to 1440 verification minutes.")
        }
        return minutes
    }

    /// True when the checkout has a commit that is not the `published` one.
    func HasCorrection(published string) bool -> Commit != "" && Commit != published

    func ValidCommit(published string) string {
        if !HasCorrection(published) {
            throw Exception("Commit the correction in the saved checkout first.")
        }
        return Commit
    }

    shared {
        let Initial AmendmentDraft = AmendmentDraft{Commit: "", Subject: "", Summary: PublicSummary.Empty, Tools: "", Verification: "30"}
    }
}

data struct PullRequestPreview {
    var Title string
    var Body string
    var Base string
    var Head string
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
    /// True while the coordinator has a request of the selected run. `Note` tells the donor about it.
    var Waiting bool
    var Note Feedback
    var Review PullRequestPreview?

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
            Note: Feedback{Message: "", Report: ""},
        }
    }
}
