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
        return []Blob{
            Heading{Content: state.Identity + (state.IssueTitle == "" ? "": " · " + state.IssueTitle)}.Build(),
            Label{Content: state.Policy.Loaded ? "Owner policy · " + state.LimitLabel + " per task": "Gratis · No Tokate policy", Muted: true}.Build(),
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
                                Providers: state.RepositoryMode && draft.Harness == "omp" ? ModelChoice.Providers(state.OmpModels): state.Policy.Providers(draft.Harness),
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
                            TimeBudget{Caption: "Total", Minutes: int32.TryParse(state.Total, out var total) ? total: 0, Minimum: 5, Optional: true, Hint: "Across all tasks.", Disabled: page.Busy, Button: page.Button, OnChange: value -> donation.SetTotal(value)}.Build(),
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
            state.RepositoryMode ? Panel{Name: "Repository options", Children: state.Policy.Loaded ? []Blob{
                Label{Content: "Issue lists and pull request review are available in Gratis mode only.", Muted: true}.Build(),
            }: []Blob{
                InputField{Label: "Issues (optional)", Value: state.IssueList ?? "", Placeholder: state.Repository + "#12,15,40", Disabled: page.Busy, OnChange: value -> donation.SetIssueList(value)}.Build(),
                Check{Label: "Review each pull request before publishing", Value: state.ReviewEach, Disabled: page.Busy, OnChange: value -> donation.SetReviewEach(value)}.Build(),
                InputField{Label: "Guidance file or URL (optional)", Value: state.Prompt, Disabled: page.Busy, OnChange: value -> donation.SetPrompt(value)}.Build(),
            }}.Build(): Stack{Children: []Blob{}}.Build(),
            Row{
                Children: []Blob{
                    (page.Button with{Label = "Back", OnClick = () -> donation.Back()}).Build(),
                    (page.Button with{Label = "Review donation", OnClick = () -> donation.Review(), Primary = true}).Build(),
                },
            }.Build(),
        }
    }
}
