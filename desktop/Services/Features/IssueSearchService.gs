package TokateDesktop

import System
import System.Collections.Generic

/// Paged search of one repository's open issues. A search for `#123` or `123` fetches that issue.
class IssueSearchService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let changed Action
    var Repository string = ""
    var Current IssueListing

    init(
        filter IssueFilter,
        commands CommandRunner,
        activity ActivityService,
        feedback FeedbackService,
        changed Action
    ) {
        Current = IssueListing.Empty(filter)
        this.commands = commands
        this.activity = activity
        this.feedback = feedback
        this.changed = changed
    }

    /// Clears results and targets `repository` with the given filter.
    func Reset(repository string, filter IssueFilter) {
        Repository = repository
        Current = IssueListing.Empty(filter)
        changed()
    }

    func SetQuery(query string) {
        Current = Current with{Query = query}
        changed()
    }

    func SetFilter(filter IssueFilter) {
        Current = Current with{Filter = filter}
        Search(1, true)
    }

    /// Loads `page`. `apply` first adopts the typed query.
    func Search(page int32 = 1, apply bool = false) {
        var listing = Current
        if apply {
            if listing.Query.Length > 200 {
                feedback.Show("Keep the search under 200 characters.")
                return
            }
            listing = listing with{AppliedQuery = listing.Query.Trim()}
        }
        let numbered = listing.RequestedNumber() > 0
        Current = listing with{Rows = []Issue{}, Loaded = true}
        activity.Activate("Search issues")
        let started = commands.GitHub[IssueSearchPage](
            GitHubCommands.SearchIssues(Repository, listing, page),
            value -> numbered ? IssueCodec.Single(value): IssueCodec.Search(value),
            (reply Reply[IssueSearchPage]) -> Loaded(reply, numbered, page)
        )
        if !started {
            changed()
        }
    }

    private func Loaded(reply Reply[IssueSearchPage], numbered bool, page int32) {
        Current = Current with{Loaded = true, Page = page}
        if reply.Outcome.ExitCode != 0 {
            if numbered {
                Current = Current with{Total = 0}
            }
            commands.Failed(reply.Outcome)
            changed()
            return
        }
        let rows = List[Issue]()
        for issue in reply.Value.Rows {
            if rows.Count == IssueListing.PageSize {
                break
            }
            if Current.Accepts(issue, Repository) {
                rows.Add(issue)
            }
        }
        Current = Current with{
            Rows = rows.ToArray(),
            Total = numbered ? rows.Count: reply.Value.Total,
            Incomplete = reply.Value.Incomplete,
        }
        changed()
    }
}
