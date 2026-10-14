package TokateDesktop

import Goo
import System

/// The project's open issues, or one issue's approval and draft pull requests.
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
            let work = state.WorkFor(number)
            let needsApproval = work?.NeedsApproval ?? false
            let status = needsApproval ? "Needs fresh approval": work != nil && work!!.Drafts.Length > 0 ? "Needs review":
            work != nil ? work!!.State.Replace('_', ' '): issue.IsApproved ? "Approved": "Needs approval"
            return []Blob{
                Row{
                    Children: []Blob{
                        (page.Button with{
                            Label = "Back to issues",
                            Kind = ButtonKind.Quiet,
                            Icon = "arrow_back",
                            IconFirst = true,
                            OnClick = () -> owner.Deselect(),
                        }).Build(),
                        Spacer{}.Build(),
                        (page.Button with{
                            Label = "Refresh contribution",
                            Kind = ButtonKind.Quiet,
                            Icon = "refresh",
                            OnClick = () -> owner.Inspect(number),
                        }).Build(),
                    },
                }.Build(),
                PageTitle{
                    Title: issue.Title,
                    Caption: repository + " #" + number,
                    Links: []Blob{
                        (page.Button with{
                            Label = "Open issue",
                            Name = "Open issue #" + number,
                            Kind = ButtonKind.Quiet,
                            Icon = "open_in_new",
                            AllowWhileBusy = true,
                            OnClick = () -> Browser.Open("https://github.com/" + repository + "/issues/" + number),
                        }).Build(),
                    },
                    Trailing: StatusBadge{Value: status, Tone: Statuses.ToneOf(status)}.Build(),
                    Stacked: page.NarrowContent,
                }.Build(),
                OwnerIssueCard{
                    Issue: issue,
                    Work: work,
                    Reading: work == nil && page.Busy,
                    Reviews: state.Reviews,
                    CanWrite: state.Project.CanWrite,
                    SupportsApproval: state.Policy.Version >= 2,
                    Compact: page.CompactPanels,
                    Button: page.Button,
                    OnApproval: () -> {
                        if issue.IsApproved && !needsApproval {
                            owner.Revoke(issue)
                        } else {
                            owner.Approve(issue)
                        }
                    },
                    OnReview: pr -> Browser.Open("https://github.com/" + repository + "/pull/" + pr),
                    OnVerify: pr -> owner.CheckPullRequest(pr, "verify"),
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
                ShowApproval: true,
                Loader: page.Loader,
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
