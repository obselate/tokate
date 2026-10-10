package TokateDesktop

import Goo
import System

partial class ThemedControls {
    func IssueSearch(search IssueSearchService, owner bool = false) Blob -> IssueSearchBar{
        Listing: search.Current,
        Button: Command(),
        Disabled: Busy,
        ShowFilters: owner,
        OnQuery: value -> search.SetQuery(value),
        OnSearch: () -> search.Search(1, true),
        OnFilter: filter -> search.SetFilter(filter),
    }.Build()

    func TablePanel() Container -> ListPanel{Short: Short()}.Build()

    func IssueRows(search IssueSearchService, choose Action[Issue]) Blob -> IssueTable{
        Listing: search.Current,
        Short: Short(),
        Busy: Busy,
        OnChoose: choose,
    }.Build()

    func IssuePagination(search IssueSearchService, change Action[int32]) Blob -> IssuePager{
        Listing: search.Current,
        Button: Command(),
        Narrow: ContentWidth < 540,
        OnPage: change,
    }.Build()

    func PageNavigation(page int32, total int32, summary string, change Action[int32]) Blob -> Pager{
        Button: Command(),
        Page: page,
        LastPage: IssueListing.LastPage(total),
        Summary: summary,
        Narrow: ContentWidth < 540,
        OnChange: change,
    }.Build()
}
