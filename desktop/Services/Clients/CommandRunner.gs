package TokateDesktop

import System
import System.Text.Json

/// Runs commands as the current activity. Each call begins the activity, runs the client in a `go` worker
/// and finishes on the UI thread. On completion the feedback message reflects the outcome, and `finish`
/// runs unless the command failed to produce a result (or `completeOnError` is set).
class CommandRunner {
    private let activity ActivityService
    private let feedback FeedbackService
    private let navigation NavigationService
    var RememberRun Action[string]?

    init(activity ActivityService, feedback FeedbackService, navigation NavigationService) {
        this.activity = activity
        this.feedback = feedback
        this.navigation = navigation
    }

    /// Runs a Tokate CLI command and decodes its data. Returns false when another command is running.
    func Cli[T](
        arguments []string,
        decode Func[JsonElement, T],
        finish Action[Reply[T]],
        seconds int32 = 120,
        directory string = "",
        completeOnError bool = false
    ) bool {
        let client = CliClient()
        guard let ticket = activity.Begin(arguments[0], client) else {
            return false
        }
        go RunCli(client, arguments, decode, seconds, directory, ticket, Finisher(finish, completeOnError))
        return true
    }

    /// Runs a Tokate CLI command whose data is not needed.
    func Cli(
        arguments []string,
        finish Action[CommandOutcome],
        seconds int32 = 120,
        directory string = "",
        completeOnError bool = false
    ) bool -> Cli[bool](arguments, data -> true, (reply Reply[bool]) -> finish(reply.Outcome), seconds, directory, completeOnError)

    /// Runs a GitHub CLI command and decodes its whole result.
    func GitHub[T](arguments []string, decode Func[JsonElement, T], finish Action[Reply[T]], seconds int32 = 120) bool {
        let client = GitHubClient()
        guard let ticket = activity.Begin(arguments[0], client) else {
            return false
        }
        go RunGitHub(client, arguments, decode, seconds, ticket, Finisher(finish, false))
        return true
    }

    /// Reports a command that exited with an error. On feature pages the reason becomes the message;
    /// elsewhere the raw report is shown. Returns false when the command succeeded.
    func Failed(outcome CommandOutcome) bool {
        if outcome.ExitCode == 0 {
            return false
        }
        let page = navigation.Current
        if page == Destination.Donate || page == Destination.Project || page == Destination.Saved {
            feedback.ShowError(outcome)
            return true
        }
        if outcome.RunPath != "" {
            RememberRun?.Invoke(outcome.RunPath)
        }
        feedback.ShowReport(outcome.Report)
        return true
    }

    private func Finisher[T](finish Action[Reply[T]], completeOnError bool) Action[Reply[T]] -> (reply Reply[T]) -> {
        feedback.ShowOutcome(reply.Outcome)
        if reply.Outcome.Failure == "" || completeOnError {
            finish(reply)
        }
    }

    private func RunCli[T](
        client CliClient,
        arguments []string,
        decode Func[JsonElement, T],
        seconds int32,
        directory string,
        ticket ActivityTicket,
        finish Action[Reply[T]]
    ) {
        activity.Complete(ticket, client.Run[T](arguments, decode, seconds, directory), finish)
    }

    private func RunGitHub[T](
        client GitHubClient,
        arguments []string,
        decode Func[JsonElement, T],
        seconds int32,
        ticket ActivityTicket,
        finish Action[Reply[T]]
    ) {
        activity.Complete(ticket, client.Run[T](arguments, decode, seconds), finish)
    }
}
