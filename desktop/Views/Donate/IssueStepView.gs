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
                Panel{Name: "Donation type", Children: []Blob{
                    IconHeading{Icon: "volunteer_activism", Content: "Donation type"}.Build(),
                    PresetGroup{
                        Button: page.Button,
                        Labels: []string{"Targeted issue", "Repository donation"},
                        Selected: state.RepositoryMode ? 1: 0,
                        OnChoose: index -> donation.SetRepositoryMode(index == 1),
                    }.Build(),
                }}.Build(),
                RepositoryPicker{
                    Input: state.Input,
                    Recent: state.RecentRepositories,
                    Saved: state.SavedRepositories,
                    Status: state.RepositoryStatus,
                    Tone: state.RepositoryTone,
                    Loading: state.CheckingRepository,
                    Invalid: !state.RepositoryChecked && !state.CheckingRepository && state.Input != "",
                    Button: page.Button,
                    Disabled: page.Busy,
                    OnInput: value -> donation.SetInput(value),
                    OnChoose: value -> donation.PickRepository(value),
                    OnFind: () -> donation.Find(),
                }.Build(),
            }
        }
        return []Blob{
            Panel{Name: "Selected repository", Children: []Blob{
                Row{Gap: AppTheme.Space8, Children: []Blob{
                    Heading{Content: state.Repository}.Build(),
                    StatusChip{Value: "Policy", Tone: Tone.Wait, Icon: ""}.Build(),
                    Spacer{}.Build(),
                    (page.Button with{Label = "Change repository", Icon = "arrow_back", OnClick = () -> donation.ChangeRepository()}).Build(),
                }}.Build(),
            }}.Build(),
            Panel{Name: "Approved issues", Children: []Blob{
                IconHeading{Icon: "checklist", Content: "Approved issues"}.Build(),
                Rule{}.Build(),
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
            }}.Build(),
        }
    }
}
