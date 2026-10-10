package TokateDesktop

import System

func ModelTests() {
    let policy = Policy.Empty with{Version = 2, MaxSeconds = 3600, AllowUnlimited = true}
    let draft = DonationDraft.Initial
    Regression.Check(draft.BudgetSeconds(policy) == 3600, "budget adds coding and verification minutes")
    Regression.Check(
        (draft with{Unlimited = true}).BudgetSeconds(policy) == 1800,
        "unlimited budget reserves verification only"
    )
    Regression.Throws(
        () -> (draft with{Unlimited = true}).BudgetSeconds(policy with{AllowUnlimited = false}),
        "The owner does not allow unlimited coding.",
        "unlimited needs owner permission"
    )
    Regression.Throws(
        () -> (draft with{Coding = "45"}).BudgetSeconds(policy),
        "The time budget exceeds the limit of 60 minutes.",
        "budget respects the policy limit"
    )
    Regression.Throws(
        () -> (draft with{Verification = "0"}).BudgetSeconds(policy),
        "Use whole verification minutes from 1 to 1440.",
        "verification minutes are validated"
    )
    Regression.Throws(
        () -> (draft with{Coding = "x"}).BudgetSeconds(Policy.Empty),
        "Use whole coding minutes from 1 to 1440.",
        "coding minutes are validated"
    )
    Regression.Check(draft.PresetAllowed(30, policy), "preset within the limit is allowed")
    Regression.Check(!draft.PresetAllowed(60, policy), "preset over the limit is disabled")
    Regression.Equal(draft.ForHarness("pi").Model, "", "pi clears the model")
    Regression.Equal(draft.ForHarness("codex").Effort, "high", "codex restores the default effort")
    Regression.Equal(CodexModel.EffortLabel("xhigh"), "Extra high", "xhigh effort label")
    Regression.Equal(CodexModel.EffortLabel("medium"), "Medium", "effort label capitalization")
    Regression.Equal(DonationProgress.ElapsedText(3725), "01:02:05", "elapsed time text")

    let parsed = RepositoryRef.Parse("https://github.com/owner/repo/issues/42/")
    Regression.Equal(parsed.FullName, "owner/repo", "issue URL repository")
    Regression.Check(parsed.IssueNumber() == 42, "issue URL number")
    Regression.Equal(RepositoryRef.Parse(" owner/repo ").RequestedIssue, "", "plain repository has no issue")
    Regression.Throws(
        () -> RepositoryRef.Parse("owner"),
        "Enter owner/repository or a GitHub issue URL.",
        "repository shape is validated"
    )
    Regression.Throws(
        () -> RepositoryRef.Parse("-owner/repo"),
        "Enter a valid GitHub repository.",
        "repository characters are validated"
    )
    Regression.Throws(
        () -> RepositoryRef.Parse("owner/repo/issues/abc").IssueNumber(),
        "Enter a valid GitHub issue number.",
        "issue number is validated"
    )

    let run = Run.Empty with{Repo = "owner/repo", Issue = 7, State = "generated", Pr = 3, DonorId = "9", Approval = "a"}
    let saved = SavedRun.Pending("/runs/1") with{Run = run}
    Regression.Equal(SavedRun.Pending("/runs/1").Status(), "Loading", "unread run is loading")
    Regression.Equal((saved with{Error = "bad"}).Status(), "Unavailable", "errors win")
    Regression.Equal((saved with{RemoteError = true}).Status(), "Review unavailable", "missing remote review")
    let remote = PullRequest{State: "OPEN", ReviewDecision: "", Checks: []CheckRun{}, Url: ""}
    Regression.Equal((saved with{PullRequest = remote with{State = "MERGED"}}).Status(), "Merged", "merged wins")
    Regression.Equal(
        (saved with{PullRequest = remote with{ReviewDecision = "CHANGES_REQUESTED"}}).Status(),
        "Needs amendment",
        "requested changes"
    )
    Regression.Equal(
        (saved with{PullRequest = remote with{Checks = []CheckRun{CheckRun{Status: "", Conclusion: "TIMED_OUT", State: ""}}}}).Status(),
        "CI failed",
        "failed checks"
    )
    Regression.Equal(
        (saved with{PullRequest = remote with{Checks = []CheckRun{CheckRun{Status: "QUEUED", Conclusion: "", State: ""}}}}).Status(),
        "CI pending",
        "pending checks"
    )
    Regression.Equal((saved with{PullRequest = remote with{State = "CLOSED"}}).Status(), "Closed without merge", "closed")
    Regression.Equal((saved with{PullRequest = remote}).Status(), "Ready to submit", "run state label")
    Regression.Equal(
        (saved with{Run = run with{State = "failed", FailureReason = "verification_failed"}}).Status(),
        "Verification failed",
        "verification failure"
    )
    Regression.Equal((saved with{Run = run with{State = "stale_remote_data"}}).Status(), "stale remote data", "unknown state")
    Regression.Equal(saved.Identity(2), "owner/repo #7", "loaded identity")
    Regression.Equal(SavedRun.Pending("/x").Identity(2), "Saved contribution 3", "pending identity")

    let actions = []NextAction{
        NextAction{Arguments: []string{"tokate", "status", "--run", "x"}},
        NextAction{Arguments: []string{"tokate", "submit", "--run", "x"}},
        NextAction{Arguments: []string{"tokate", "checks", "--run", "x"}},
        NextAction{Arguments: []string{"tokate", "submit", "--run", "x"}},
        NextAction{Arguments: []string{"tokate"}},
    }
    let derived = RunActions.From(actions, "claim_pending")
    Regression.Check(
        derived.Length == 3 && derived[0] == RunAction.Submit && derived[1] == RunAction.Checks && derived[2] == RunAction.Prepare,
        "next actions are filtered, deduplicated and extended"
    )
    Regression.Equal(RunActions.ButtonLabel(RunAction.Recover), "Run verification again", "recover label")

    let claim = "0f8fad5b-d9cb-469f-a165-70867728950e"
    let reservation = Reservation{
        ApprovalId: "a",
        Revoked: false,
        Lease: claim,
        Attempt: claim,
        Actor: "9",
        Status: "active",
        Expires: 2000,
    }
    Regression.Check(reservation.IsReadyFor(run, claim, 1000), "matching reservation is ready")
    Regression.Check(!(reservation with{Revoked = nil}).IsReadyFor(run, claim, 1000), "missing revoked flag is not ready")
    Regression.Check(!reservation.IsReadyFor(run, claim, 3000), "expired reservation is not ready")
    Regression.Check(!(reservation with{Actor = "8"}).IsReadyFor(run, claim, 1000), "other donor is not ready")
    Regression.Check(!(reservation with{Expires = nil}).IsReadyFor(run, claim, 1000), "missing expiry is not ready")

    let amendment = AmendmentDraft.Initial
    Regression.Throws(() -> amendment.ValidCommit(), "Enter the complete 40-character commit.", "commit is validated")
    Regression.Throws(
        () -> (amendment with{Verification = "0"}).VerificationMinutes(),
        "Enter 1 to 1440 verification minutes.",
        "amendment minutes are validated"
    )

    let listing = IssueListing.Empty(IssueFilter.Approved)
    let issue = Issue{
        Number: 4,
        Title: "t",
        State: "open",
        Labels: []string{"tokate:approved"},
        Url: "https://github.com/owner/repo/issues/4",
    }
    Regression.Check(listing.Accepts(issue, "owner/repo"), "approved issue is accepted")
    Regression.Check(!listing.Accepts(issue with{Labels = []string{}}, "owner/repo"), "unapproved issue is filtered")
    Regression.Check(!listing.Accepts(issue, "other/repo"), "foreign issue URL is filtered")
    Regression.Check((listing with{AppliedQuery = "#12"}).RequestedNumber() == 12, "issue number search")
    Regression.Check(IssueListing.LastPage(17) == 3, "last page")

    let outcome = CommandOutcome{Diagnostics: "first line\nsecond", Failure: "", Report: "", RunPath: "", ExitCode: 1}
    Regression.Equal(outcome.ErrorMessage(), "first line", "diagnostics fallback")
    Regression.Equal(
        (outcome with{Diagnostics = ""}).ErrorMessage(),
        "Could not complete this action.",
        "generic fallback"
    )

    let setup = SetupDraft.From(Policy.Empty)
    Regression.Equal(setup.ModelPolicy, "unrestricted", "missing policy starts unrestricted")
    Regression.Equal(setup.EffectiveEligibility(Policy.Empty), "trusted", "default eligibility")
    Regression.Check(setup.EffectiveTools(Policy.Empty)[0] == "codex", "default tool")
    Regression.Throws(
        () -> (setup with{Minutes = "0"}).MinutesSeconds(),
        "Enter 1 to 1440 minutes per donation.",
        "setup minutes are validated"
    )

    let start = AppTheme.Blend(AppTheme.Daylight, AppTheme.Moonlight, 0)
    Regression.Check(
        Math.Abs(start.Paper.R - AppTheme.Daylight.Paper.R) < 0.0001 &&
            Math.Abs(start.Accent.B - AppTheme.Daylight.Accent.B) < 0.0001,
        "daylight blend endpoint"
    )
    let end = AppTheme.Blend(AppTheme.Daylight, AppTheme.Moonlight, 1)
    Regression.Check(Math.Abs(end.Ink.G - AppTheme.Moonlight.Ink.G) < 0.0001, "moonlight blend endpoint")
    Regression.Check((LayoutMetrics.Initial with{WindowWidth = 899}).Compact, "compact width")
    Regression.Check((LayoutMetrics.Initial with{WindowHeight = 599}).Short, "short height")
}
