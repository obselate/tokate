package TokateDesktop

import System

class Stop : Cancellable {
    var Stopped bool

    func Stop() {
        Stopped = true
    }

    func RecentOutput() string -> ""
}

func ShellTests() {
    var changes = 0
    let changed = () -> {
        changes++
    }
    let feedback = FeedbackService(changed)
    let pending = CommandOutcome{
        Envelope: CliCodec.Envelope(Regression.Fixture("envelope-pending.json")) with{Status = CliStatus.Pending, ExitCode = 8},
        ExitCode: 8,
        Diagnostics: "",
        Failure: "",
        Report: "",
        RunPath: "",
    }
    feedback.ShowOutcome(pending)
    Regression.Equal(feedback.Current.Message, "Pending. Another person or the coordinator needs to act.", "pending notice")
    feedback.ShowOutcome(pending with{Envelope = nil, ExitCode = 1})
    Regression.Equal(feedback.Current.Message, "This action needs attention.", "attention notice")
    feedback.ShowOutcome(pending with{Failure = "Command timed out."})
    Regression.Equal(feedback.Current.Message, "Command timed out.", "failure wins")
    let before = changes
    feedback.ShowOutcome(pending with{Failure = "Command timed out."})
    Regression.Check(changes == before, "unchanged feedback does not notify")
    feedback.ShowReport("report")
    feedback.ShowError(pending with{Envelope = nil, ExitCode = 1, Diagnostics = "broken\nmore"})
    Regression.Check(feedback.Current.Message == "broken" && feedback.Current.Report == "", "errors clear the report")

    let dialogs = DialogService(changed)
    var confirmed = false
    dialogs.Ask(Confirmation{Title: "Start?", Text: "", ConfirmLabel: "Start", Heading: ""}, () -> {
        confirmed = !dialogs.Open
    })
    Regression.Check(dialogs.Open, "dialog opens")
    dialogs.Confirm()
    Regression.Check(confirmed && !dialogs.Open, "dialog closes before its action runs")

    let navigation = NavigationService(changed)
    navigation.Go(Destination.Saved)
    Regression.Check(navigation.Current == Destination.Saved, "navigation moves")
    Regression.Check(Destinations.Parse("My project") == Destination.Project, "destination labels parse")

    let window = WindowService(changed)
    let activity = ActivityService(window, navigation, feedback, changed)
    let stop = Stop()
    feedback.Show("old")
    let ticket = activity.Begin("status", stop)
    Regression.Check(ticket != nil && activity.Busy, "activity begins")
    Regression.Check(feedback.Current.Message == "", "starting a command clears feedback")
    Regression.Equal(activity.Current.Title, "Loading saved work", "activity title")
    Regression.Check(activity.Current.Page == Destination.Saved && !activity.Current.Visible, "activity page")
    Regression.Check(activity.Begin("status", Stop()) == nil, "one command at a time")
    activity.Cancel()
    Regression.Check(stop.Stopped && activity.Current.Stopping, "cancel stops the runner")
}
