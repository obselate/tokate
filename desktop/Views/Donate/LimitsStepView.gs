package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Step II: the harness, model and time limits.
class LimitsStepView {
    private let donation DonationService
    private let art ArtworkService
    private let manage Action

    init(donation DonationService, art ArtworkService, manage Action) {
        this.donation = donation
        this.art = art
        this.manage = manage
    }

    func Build(page PageContext) []Blob {
        let state = donation.Current
        let draft = state.Draft
        let repository = List[Blob]{
            Row{Gap: AppTheme.Space8, Children: []Blob{
                Heading{Content: state.Identity}.Build(),
                StatusChip{Value: state.Policy.Loaded ? "Policy": "Gratis", Tone: Tone.Wait, Icon: ""}.Build(),
                Spacer{}.Build(),
                (page.Button with{Label = "Change repository", Icon = "arrow_back", OnClick = () -> donation.Back()}).Build(),
            }}.Build(),
        }
        if state.IssueTitle != "" { repository.Add(Label{Content: state.IssueTitle, Muted: true}.Build()) }
        return []Blob{
            Panel{Name: "Selected repository", Children: repository.ToArray()}.Build(),
            Panel{
                Name: "Harness settings",
                Children: []Blob{
                    IconHeading{Icon: "terminal", Content: "Harness"}.Build(),
                    HarnessPicker{
                        Selected: draft.Harness,
                        Policy: state.Policy,
                        Unready: state.Unready,
                        Logo: id -> art.Logo(id).Render(),
                        Disabled: page.Busy,
                        OnChoose: id -> donation.ChooseHarness(id),
                    }.Build(),
                },
            }.Build(),
            CardColumns{
                Stacked: page.Metrics.ContentWidth < AppTheme.ColumnsBreakpoint,
                Cards: []Container{
                    Panel{
                        Name: "Model settings",
                        Children: []Blob{
                            IconHeading{Icon: "tune", Content: "Model"}.Build(),
                            ModelPicker{
                                Harness: draft.Harness,
                                Provider: draft.Provider,
                                Providers: state.Providers(),
                                Model: draft.Model,
                                Effort: draft.Effort,
                                Endpoint: draft.Endpoint,
                                Models: state.Catalog(),
                                Efforts: state.Efforts(),
                                Disabled: page.Busy,
                                OnModel: value -> donation.SetModel(value),
                                OnEffort: value -> donation.SetEffort(value),
                                OnEndpoint: value -> donation.SetEndpoint(value),
                                OnProvider: value -> donation.SetProvider(value),
                                Popup: page.Popup,
                            }.Build(),
                            Rule{}.Build(),
                            ProfilePicker{
                                Profiles: state.Profiles,
                                Selected: draft.Profile,
                                Button: page.Button,
                                Disabled: page.Busy,
                                OnUse: profile -> donation.UseProfile(profile),
                                OnManage: manage,
                                Popup: page.Popup,
                            }.Build(),
                        },
                    }.Build(),
                    state.RepositoryMode ? Panel{
                        Name: "Repository donation limits",
                        Children: []Blob{
                            IconHeading{Icon: "schedule", Content: "Time"}.Build(),
                            TimeBudget{Caption: "Per task", Minutes: int32.Parse(state.PerTask), Minimum: 1, Maximum: state.LimitMinutes, Hint: state.LimitLabel, Disabled: page.Busy, Button: page.Button, OnChange: value -> donation.SetPerTask(value)}.Build(),
                            TimeBudget{Caption: "Total", Minutes: int32.TryParse(state.Total, out var total) ? total: 0, Minimum: 5, Optional: true, Hint: "Across all tasks", Disabled: page.Busy, Button: page.Button, OnChange: value -> donation.SetTotal(value)}.Build(),
                        },
                    }.Build(): TimeLimits{
                        Draft: draft,
                        Policy: state.Policy,
                        Button: page.Button,
                        Disabled: page.Busy,
                        OnUnlimited: value -> donation.SetUnlimited(value),
                        OnCoding: value -> donation.SetCoding(value),
                        OnVerification: value -> donation.SetVerification(value),
                    }.Build(),
                },
            }.Build(),
            state.RepositoryMode && !state.Policy.Loaded ? Panel{Name: "Repository options", Children: []Blob{
                IconHeading{Icon: "checklist", Content: "Tasks and publishing"}.Build(),
                RepositoryIssues(page),
                Check{Label: "Review each pull request before publishing", Value: state.ReviewEach, Disabled: page.Busy, OnChange: value -> donation.SetReviewEach(value)}.Build(),
                InputField{Label: "Guidance file or URL (optional)", Value: state.Prompt, Disabled: page.Busy, OnChange: value -> donation.SetPrompt(value)}.Build(),
            }}.Build(): Stack{Children: []Blob{}}.Build(),
            ActionBar{
                Children: []Blob{
                    (page.Button with{Label = "Back", OnClick = () -> donation.Back()}).Build(),
                    (page.Button with{Label = "Review donation", OnClick = () -> donation.Review(), Primary = true}).Build(),
                },
            }.Build(),
        }
    }

    private func RepositoryIssues(page PageContext) Blob {
        let listing = donation.Issues.Current
        let selected = (donation.Current.IssueList ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
        let rows = List[Blob]()
        for issue in listing.Rows {
            let number = issue.NumberText
            let order = Array.IndexOf(selected, number)
            rows.Add(ListRow{Name: "Issue " + number, Children: []Blob{
                Check{Label: "#" + number + "  " + issue.Title, Value: order >= 0, Disabled: page.Busy, OnChange: value -> donation.ToggleIssue(number, value)}.Build(),
                order >= 0 ? StatusChip{Value: "Run " + (order + 1).ToString(), Tone: Tone.Wait, Icon: ""}.Build(): Stack{Children: []Blob{}}.Build(),
            }}.Build())
        }
        if !listing.Loaded {
            rows.Add(ListRow{Children: []Blob{(page.Button with{Label = "Choose issues", OnClick = () -> donation.LoadRepositoryIssues()}).Build()}}.Build())
        } else {
            rows.Insert(0, ListRow{Children: []Blob{Row{Align: AlignItems.FlexEnd, Children: []Blob{
                InputField{Label: "Search open issues", Value: listing.Query, OnChange: value -> donation.Issues.SetQuery(value), Disabled: page.Busy}.Build(),
                (page.Button with{Label = "Search", OnClick = () -> donation.Issues.Search(1, true)}).Build(),
            }}.Build()}}.Build())
            if page.Busy { rows.Add(ListRow{Children: []Blob{Loader{Message: "Loading issues", Key: "repository-issues"}.Build()}}.Build()) }
            if listing.Rows.Length == 0 && !page.Busy { rows.Add(ListRow{Children: []Blob{Label{Content: "No open issues found", Muted: true}.Build()}}.Build()) }
            rows.Add(ListRow{Children: []Blob{IssuePager{Listing: listing, Button: page.Button, Narrow: page.NarrowContent, OnPage: number -> donation.Issues.Search(number)}.Build()}}.Build())
        }
        return ListSection{Title: "Open issues", Count: listing.Loaded ? listing.Total: -1, Note: selected.Length == 0 ? "Optional · The harness chooses": "Run order: #" + String.Join(", #", selected), Children: rows.ToArray()}.Build()
    }
}
