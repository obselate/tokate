package TokateDesktop

import System
import System.Collections.Generic

/// Paged search of one repository's open issues. A search for `#123` or `123` fetches that issue. One request
/// fetches a batch of pages, so a page change inside the batch shows at once. The rows in view stay until the
/// next result arrives.
class IssueSearchService {
    private let commands CommandRunner
    private let activity ActivityService
    private let feedback FeedbackService
    private let changed Action
    private var batch []Issue = []Issue{}
    /// The number of the batch that is held. Zero when none is.
    private var held int32
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
        held = 0
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

    /// Shows `page`. `apply` first adopts the typed query and fetches again.
    func Search(page int32 = 1, apply bool = false) {
        var listing = Current
        if apply {
            if listing.Query.Length > 200 {
                feedback.Show("Keep the search under 200 characters.")
                return
            }
            listing = listing with{AppliedQuery = listing.Query.Trim()}
        }
        let needed = (page - 1) / IssueListing.BatchPages + 1
        if !apply && needed == held {
            Show(page)
            changed()
            return
        }
        let numbered = listing.RequestedNumber() > 0
        Current = listing with{Loaded = true}
        activity.Activate("Search issues")
        let started = commands.GitHub[IssueSearchPage](
            GitHubCommands.SearchIssues(Repository, listing, needed),
            value -> numbered ? IssueCodec.Single(value): IssueCodec.Search(value),
            (reply Reply[IssueSearchPage]) -> Loaded(reply, numbered, page, needed)
        )
        if !started {
            changed()
        }
    }

    private func Loaded(reply Reply[IssueSearchPage], numbered bool, page int32, number int32) {
        Current = Current with{Loaded = true, Page = page}
        if reply.Outcome.ExitCode != 0 {
            held = 0
            Current = Current with{Rows = []Issue{}, Total = numbered ? 0: Current.Total}
            commands.Failed(reply.Outcome)
            changed()
            return
        }
        batch = reply.Value.Rows
        held = number
        Current = Current with{Total = reply.Value.Total, Incomplete = reply.Value.Incomplete}
        Show(page)
        if numbered {
            Current = Current with{Total = Current.Rows.Length}
        }
        changed()
    }

    /// Shows the rows of `page` from the held batch.
    private func Show(page int32) {
        let rows = List[Issue]()
        let start = (page - 1) % IssueListing.BatchPages * IssueListing.PageSize
        for index in start ... Math.Min(batch.Length, start + IssueListing.PageSize) {
            if Current.Accepts(batch[index], Repository) {
                rows.Add(batch[index])
            }
        }
        Current = Current with{Page = page, Rows = rows.ToArray()}
    }
}
