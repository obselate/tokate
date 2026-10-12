package TokateDesktop

import Goo
import System

/// Step I: find a repository, then choose one of its approved issues.
class IssueStepView {
    private let donation DonationService

    init(donation DonationService) {
        this.donation = donation
    }

    /// The step's blocks, laid out directly in the page so the issue table can fill it.
    func Build(page PageContext) []Blob {
        let state = donation.Current
        let search = donation.Issues
        if !search.Current.Loaded {
            return []Blob{
                RepositoryFinder{
                    Input: state.Input,
                    Account: state.Account,
                    Button: page.Button,
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    OnInput: value -> donation.SetInput(value),
                    OnFind: () -> donation.Find(),
                }.Build(),
            }
        }
        return []Blob{
            Row{
                Children: []Blob{
                    Heading{Content: state.Repository}.Build(),
                    (page.Button with{Label = "Change repository", Kind = ButtonKind.Quiet, OnClick = () -> donation.ChangeRepository()}).Build(),
                },
            }.Build(),
            IssueSearchBar{
                Listing: search.Current,
                Button: page.Button,
                Disabled: page.Busy,
                OnQuery: value -> search.SetQuery(value),
                OnSearch: () -> search.Search(1, true),
                OnFilter: filter -> search.SetFilter(filter),
            }.Build(),
            IssueTable{
                Listing: search.Current,
                Short: page.Metrics.Short,
                Busy: page.Busy,
                Loader: page.Loader,
                OnChoose: issue -> donation.Choose(issue),
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
