package TokateDesktop

import System

/// Reads a saved run's local status, then its issue and pull request on GitHub. Calls block, so run them
/// from a `go` worker. `Stop` cancels the read in progress and every later one.
class RunReader : Cancellable {
    private let cli CliClient = CliClient()
    private let github GitHubClient = GitHubClient()

    func Stop() {
        cli.Stop()
        github.Stop()
    }

    func RecentOutput() string -> ""

    /// Reads `source`, reporting the local status through `changed` as soon as it is known and again with
    /// the remote state. Returns false when cancelled.
    func Read(source SavedRun, changed Action[SavedRun]) bool {
        var item = source
        if !item.Loaded {
            let status = cli.Run[Run](TokateCommands.Status(item.Path), RunCodec.Reader(item.Path))
            let outcome = status.Outcome
            if Cancelled(outcome) {
                return false
            }
            let run Run? = outcome.Failure == "" ? status.Value: nil
            var error = outcome.Failure != "" ? outcome.Failure: outcome.ExitCode != 0 ? outcome.Envelope?.Error?.Message ?? "": ""
            if run == nil || !run!!.Readable {
                error = error == "" ? "Saved contribution could not be read.": error
            }
            item = SavedRun.Pending(item.Path) with{
                Changed = item.Changed,
                Run = run,
                Actions = outcome.Envelope?.NextActions ?? []NextAction{},
                Error = error,
            }
            changed(item)
        }
        var updated = item with{Refreshed = true}
        if let run = item.Run {
            if item.Error == "" {
                let issue = github.Run[Issue](GitHubCommands.Issue(run.Repo, run.Issue.ToString()), IssueCodec.Issue, 30)
                if Cancelled(issue.Outcome) {
                    return false
                }
                updated = updated with{RemoteError = !issue.Outcome.Succeeded}
                if issue.Outcome.Succeeded {
                    updated = updated with{Title = issue.Value.Title}
                }
                if run.Pr > 0 {
                    let pull = github.Run[PullRequest](
                        GitHubCommands.PullRequest(run.Repo, run.Pr.ToString()),
                        PullRequestCodec.PullRequest,
                        30
                    )
                    if Cancelled(pull.Outcome) {
                        return false
                    }
                    updated = updated with{RemoteError = updated.RemoteError || !pull.Outcome.Succeeded}
                    if pull.Outcome.Succeeded {
                        updated = updated with{PullRequest = pull.Value}
                    }
                }
            }
        }
        changed(updated)
        return true
    }

    private func Cancelled(outcome CommandOutcome) bool -> outcome.Failure.StartsWith("Command cancelled")
}
