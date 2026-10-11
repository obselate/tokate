package TokateDesktop

import Goo
import System

/// The project's open issues, or one issue's approval and contributions.
class ContributionsTab {
    private let owner OwnerService

    init(owner OwnerService) {
        this.owner = owner
    }

    /// The tab's blocks, laid out directly in the page so the issue table can fill it.
    func Build(page PageContext) []Blob {
        let state = owner.Current
        if let issue = state.Selected {
            let repository = owner.Repository
            let number = issue.NumberText
            return []Blob{
                Row{
                    Children: []Blob{(page.Button with{Label = "Back to issues", Kind = ButtonKind.Quiet, OnClick = () -> owner.Deselect()}).Build()},
                }.Build(),
                OwnerIssueCard{
                    Issue: issue,
                    Work: state.WorkFor(number),
                    CanWrite: state.Project.CanWrite,
                    SupportsApproval: state.Policy.Version >= 2,
                    Compact: page.CompactPanels,
                    Button: page.Button,
                    OnRefresh: () -> owner.Inspect(number),
                    OnOpen: () -> Browser.Open("https://github.com/" + repository + "/issues/" + number),
                    OnApproval: () -> {
                        if issue.IsApproved {
                            owner.Revoke(issue)
                        } else {
                            owner.Approve(issue)
                        }
                    },
                    OnReview: pr -> Browser.Open("https://github.com/" + repository + "/pull/" + pr),
                    OnVerify: pr -> owner.CheckPullRequest(pr, "verify-pr"),
                    OnChecks: pr -> owner.CheckPullRequest(pr, "checks"),
                }.Build(),
            }
        }
        let search = owner.Issues
        return []Blob{
            IssueSearchBar{
                Listing: search.Current,
                Button: page.Button,
                Disabled: page.Busy,
                ShowFilters: true,
                OnQuery: value -> search.SetQuery(value),
                OnSearch: () -> search.Search(1, true),
                OnFilter: filter -> search.SetFilter(filter),
            }.Build(),
            IssueTable{
                Listing: search.Current,
                Short: page.Metrics.Short,
                Busy: page.Busy,
                OnChoose: issue -> owner.Select(issue),
            }.Build(),
            IssuePager{
                Listing: search.Current,
                Button: page.Button,
                Narrow: page.NarrowContent,
                OnPage: number -> search.Search(number),
            }.Build(),
        }
    }
}
