package TokateDesktop

import System

func SavedTests() {
    let changed = () -> { }
    let feedback = FeedbackService(changed)
    let navigation = NavigationService(changed)
    let window = WindowService(changed)
    let activity = ActivityService(window, navigation, feedback, changed)
    let dialogs = DialogService(changed)
    let saved = SavedWorkService(CommandRunner(activity, feedback, navigation), activity, feedback, dialogs, window, changed)

    saved.Remember("/runs/a")
    Regression.Equal(saved.Current.RunPath, "/runs/a", "remembered run")
    saved.ToggleImport()
    Regression.Check(saved.Current.Importing && !saved.Current.Browsing, "importing is not browsing")
    saved.ToggleImport()

    let run = Run.Empty with{Repo = "owner/repo", Issue = 7, State = "claim_pending", Pr = 2}
    saved.Select(SavedRun.Pending("/runs/b") with{Run = run})
    Regression.Check(saved.Current.Selected && saved.Current.RunPath == "/runs/b", "selecting a run")
    Regression.Check(
        saved.Current.Actions.Length == 1 && saved.Current.Actions[0] == RunAction.Claim,
        "a pending reservation can be checked"
    )
    saved.Select(SavedRun.Pending("/runs/c"))
    Regression.Equal(saved.Current.RunPath, "/runs/b", "unread runs cannot be selected")

    var started = ""
    saved.OnWork = (value, path) -> {
        started = value.Identity + " " + path
    }
    saved.Act(RunAction.Work)
    Regression.Equal(started, "owner/repo #7 /runs/b", "work continues on the donate page")

    saved.ToggleAmendment()
    saved.SetVerification("0")
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Enter 1 to 1440 verification minutes.", "amendment minutes are validated")
    saved.SetVerification("11")
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Commit the correction in the saved checkout first.", "amendment needs a new commit")
    saved.Current = saved.Current with{Amendment = saved.Current.Amendment with{Commit = "0123456789abcdef0123456789abcdef01234567"}}
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Add at least one change to the summary.", "amendment needs a change line")
    saved.SetSummary(PublicSummary.Empty with{Changes = []string{"Fix the table header.", "See https://example.com"}})
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Correct the marked summary lines first.", "amendment lines follow the public text rules")
    saved.SetSummary(PublicSummary.Empty with{Changes = []string{" Fix the table header. ", ""}})
    saved.SetEdited(EditedBy.Other)
    saved.SetTools("/nonexistent/tools.json")
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Selected tool declarations file does not exist.", "the tool declarations file must exist")
    saved.SetEdited(EditedBy.Hand)
    saved.Act(RunAction.Amend)
    Regression.Check(dialogs.Open && dialogs.Current?.Title == "Publish amendment", "amendment asks first")
    Regression.Check(dialogs.Current?.Text == "owner/repo #7\n\n" + RunActions.DialogDetail(RunAction.Amend), "amendment dialog text")
    dialogs.Dismiss()
    Regression.Check(!activity.Busy, "dismissing runs nothing")
    Regression.Equal(
        AmendmentFailures.Explain(
            "candidate_changed",
            "git failed: diff --git a/__pycache__/greet.pyc b/__pycache__/greet.pyc\nindex fcd6e84..d8c8c12 100644\ndiff --git a/out/a b.txt b/out/a b.txt\n"
        ),
        "The verification commands changed files that the commit tracks: __pycache__/greet.pyc, out/a b.txt. Remove generated files from the commit, then publish again.",
        "a changed candidate names the files that verification changed"
    )
    Regression.Equal(PublicSummary.Problem("Set retries=3 by default."), "", "a summary line can have an equals sign, as Tokate accepts it")
    let continuation = NextAction{Arguments: []string{"tokate", "work", "owner/repo#42", "--continue-from", "/runs/stopped", "--time", "2h", "--yes", "--json"}}
    Regression.Check(RunActions.From([]NextAction{continuation}, "failed").Length == 0, "continuation cannot discard the fresh attempt arguments")
    saved.Follow(continuation)
    Regression.Equal(dialogs.Current?.Text ?? "", Regression.Args(continuation.Arguments), "continuation confirmation preserves exact argv")
    dialogs.Dismiss()
    for operation in []string{"authorize", "revoke"} {
        let sync = NextAction{Arguments: []string{"tokate", "sync", "owner/repo#2", operation, "--json"}}
        Regression.Check(!sync.NamesRun && RunActions.From([]NextAction{sync}, "published").Length == 0, "sync is not a saved-run action")
        saved.Follow(sync)
        Regression.Equal(dialogs.Current?.Text ?? "", Regression.Args(sync.Arguments), "sync confirmation preserves operation argv")
        dialogs.Dismiss()
    }
    Regression.Check(RunGuide.For("Initial donation failed", false).Main == nil, "failed inference is not restarted in the same attempt")

    saved.Select(SavedRun.Pending("/runs/b") with{Run = run})
    Regression.Check(
        !saved.Current.Amendment.Open && saved.Current.Amendment.Verification == "11",
        "selecting closes the amendment and keeps its settings"
    )
}
