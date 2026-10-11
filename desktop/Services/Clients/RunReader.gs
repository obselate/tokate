package TokateDesktop

import System

/// Reads a saved run's local status, then its issue and pull request on GitHub at the same time. Calls block,
/// so run them from a `go` worker. `Stop` cancels the read in progress and every later one.
class RunReader : Cancellable {
    private let cli CliClient = CliClient()
    private let issues GitHubClient = GitHubClient()
    private let pulls GitHubClient = GitHubClient()

    func Stop() {
        cli.Stop()
        issues.Stop()
        pulls.Stop()
    }

    func RecentOutput() string -> ""

    /// Reads `source` with its remote state. Returns nil when cancelled.
    func Read(source SavedRun) SavedRun? {
        var item = source
        if !item.Loaded {
            let status = cli.Run[Run](TokateCommands.Status(item.Path), RunCodec.Reader(item.Path))
            let outcome = status.Outcome
            if Cancelled(outcome) {
                return nil
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
        }
        var updated = item with{Refreshed = true}
        guard let run = item.Run else {
            return updated
        }
        if item.Error != "" {
            return updated
        }
        scope {
            async let issue = issues.Run[Issue](
                GitHubCommands.Issue(run.Repo, run.Issue.ToString()),
                IssueCodec.Issue,
                30
            )
            async let pull = Pull(run)
            let found = await issue
            let review = await pull
            if Cancelled(found.Outcome) || Cancelled(review.Outcome) {
                return nil
            }
            updated = updated with{RemoteError = !found.Outcome.Succeeded || !review.Outcome.Succeeded}
            if found.Outcome.Succeeded {
                updated = updated with{Title = found.Value.Title}
            }
            if run.Pr > 0 && review.Outcome.Succeeded {
                updated = updated with{PullRequest = review.Value}
            }
        }
        return updated
    }

    /// The pull request of `run`, or an empty success when it has none.
    private func Pull(run Run) Reply[PullRequest] {
        if run.Pr == 0 {
            return Reply[PullRequest]{Outcome: CommandOutcome{Diagnostics: "", Failure: "", Report: "", RunPath: ""}}
        }
        return pulls.Run[PullRequest](
            GitHubCommands.PullRequest(run.Repo, run.Pr.ToString()),
            PullRequestCodec.PullRequest,
            30
        )
    }

    private func Cancelled(outcome CommandOutcome) bool -> outcome.Failure.StartsWith("Command cancelled")
}
