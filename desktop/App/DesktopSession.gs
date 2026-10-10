package TokateDesktop

import Goo
import System
import System.Text.Json

/// Temporary adapter that lets the screens not yet moved to services reach the shell services.
/// Removed once every feature slice uses its own service.
class DesktopSession {
    private let app DesktopApp
    let Refresh Action
    let Navigate Action[string]
    let RememberRun Action[string]
    var ConfirmationContent Func[Blob]?

    init(app DesktopApp, refresh Action, navigate Action[string], rememberRun Action[string]) {
        this.app = app
        Refresh = refresh
        Navigate = navigate
        RememberRun = rememberRun
    }

    prop Busy bool -> app.Activity.Busy

    prop Title string -> app.Activity.Current.Title

    prop Stopping bool -> app.Activity.Current.Stopping

    prop ActivePage string -> Destinations.Label(app.Activity.Current.Page)

    prop Page string -> Destinations.Label(app.Navigation.Current)

    prop Window Window? -> app.Window.Window

    prop ActionName string {
        get -> app.Activity.Current.ActionName
        set -> app.Activity.Activate(value)
    }

    prop Message string {
        get -> app.Feedback.Current.Message
        set -> app.Feedback.Show(value)
    }

    prop Report string {
        get -> app.Feedback.Current.Report
        set -> app.Feedback.ShowReport(value)
    }

    func IssueSearch(filter IssueFilter) IssueSearchService -> IssueSearchService(
        filter,
        app.Activity,
        app.Feedback,
        () -> app.RequestRefresh()
    )

    func Post(action Action) {
        app.Window.Post(action)
    }

    func Cancel() -> app.Activity.Cancel()

    func Confirm(title string, text string, action Action, label string = "Confirm", content Func[Blob]? = nil) {
        ConfirmationContent = content
        app.Dialogs.Ask(Confirmation{Title: title, Text: text, ConfirmLabel: label, Heading: ""}, action)
    }

    func Execute(
        arguments[]string,
        completed Action[CommandResult],
        tool string = "tokate",
        directory string = "",
        seconds int32 = 120,
        completeOnError bool = false,
        progress Action[int32, string]? = nil
    ) {
        let next = CommandClient()
        guard let ticket = app.Activity.Begin(arguments[0], next, progress != nil, progress) else {
            return
        }
        let finish = (result CommandResult) -> {
            app.Feedback.Show(
                result.Error != "" ? result.Error: TextOf(result.Value, "status") == "pending" ?
                "Pending. Another person or the coordinator needs to act.": result.ExitCode != 0 ?
                "This action needs attention.": ""
            )
            if result.Error == "" || completeOnError {
                completed(result)
            }
        }
        go RunLegacy(next, arguments, tool, directory, seconds, ticket, finish)
    }

    private func RunLegacy(
        runner CommandClient,
        arguments []string,
        tool string,
        directory string,
        seconds int32,
        ticket ActivityTicket,
        finish Action[CommandResult]
    ) {
        app.Activity.Complete(ticket, runner.Run(arguments, tool, directory, seconds), finish)
    }

    func Error(result CommandResult) bool {
        if result.ExitCode == 0 {
            return false
        }
        if Page == "Donate" || Page == "My project" || Page == "Saved work" {
            var message = TextOf(Field(result.Value, "error"), "message")
            if message == "" {
                message = result.Diagnostics.Trim().Split('\n')[0]
            }
            if message == "" {
                message = "Could not complete this action."
            }
            Message = message
            Report = ""
            return true
        }
        ShowResult(result)
        return true
    }

    func ShowResult(result CommandResult) {
        let data = Field(result.Value, "data")
        let found = TextOf(data, "run")
        if found != "" {
            RememberRun(found)
        }
        let failure = Field(result.Value, "error")
        var report = failure.ValueKind == JsonValueKind.Object ? failure.ToString(): data.ToString()
        if Field(result.Value, "truncated").ValueKind == JsonValueKind.True {
            report += "\nSome results were omitted by the CLI."
        }
        Report = report
    }
}
