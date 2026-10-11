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
        saved.Current.Actions.Length == 1 && saved.Current.Actions[0] == RunAction.Prepare,
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
    saved.Act(RunAction.Recover)
    Regression.Equal(feedback.Current.Message, "Enter 1 to 1440 verification minutes.", "recovery minutes are validated")
    saved.SetVerification("11")
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Commit the correction in the saved checkout first.", "amendment needs a new commit")
    saved.Current = saved.Current with{Amendment = saved.Current.Amendment with{Commit = "0123456789abcdef0123456789abcdef01234567"}}
    saved.SetSummary("/nonexistent/summary.json")
    saved.Act(RunAction.Amend)
    Regression.Equal(feedback.Current.Message, "Selected amendment file does not exist.", "amendment files must exist")
    saved.SetSummary("")
    saved.Act(RunAction.Amend)
    Regression.Check(dialogs.Open && dialogs.Current?.Title == "Publish amendment", "amendment asks first")
    Regression.Check(dialogs.Current?.Text == "owner/repo #7\n\n" + RunActions.DialogDetail(RunAction.Amend), "amendment dialog text")
    dialogs.Dismiss()
    Regression.Check(!activity.Busy, "dismissing runs nothing")

    saved.Select(SavedRun.Pending("/runs/b") with{Run = run})
    Regression.Check(
        !saved.Current.Amendment.Open && saved.Current.Amendment.Verification == "11",
        "selecting closes the amendment and keeps its settings"
    )
}
