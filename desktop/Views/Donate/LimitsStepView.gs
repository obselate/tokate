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
        let compact = page.CompactPanels || page.Metrics.WindowHeight < 900
        return []Blob{
            Heading{Content: state.Identity + "  " + state.IssueTitle}.Build(),
            Panel{
                Compact: compact,
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
                Stacked: page.Metrics.ContentWidth < 740,
                Cards: []Container{
                    Panel{
                        Compact: compact,
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
                        Compact: compact,
                        Name: "Repository donation limits",
                        Children: []Blob{
                            IconHeading{Icon: "schedule", Content: "Time"}.Build(),
                            Label{Content: "Gratis repositories allow up to 60 minutes per task. Leave total time empty to run until stopped."}.Build(),
                            InputField{Label: "Per-task minutes", Value: state.PerTask, Disabled: page.Busy, OnChange: value -> donation.SetPerTask(value)}.Build(),
                            InputField{Label: "Total minutes (optional)", Value: state.Total, Disabled: page.Busy, OnChange: value -> donation.SetTotal(value)}.Build(),
                            InputField{Label: "Prompt URL or file (gratis only)", Value: state.Prompt, Disabled: page.Busy, OnChange: value -> donation.SetPrompt(value)}.Build(),
                        },
                    }.Build(): TimeLimits{
                        Draft: draft,
                        Policy: state.Policy,
                        Button: page.Button,
                        Disabled: page.Busy,
                        Compact: compact,
                        OnPreset: minutes -> donation.ChoosePreset(minutes),
                        OnUnlimited: value -> donation.SetUnlimited(value),
                        OnCoding: value -> donation.SetCoding(value),
                        OnVerification: value -> donation.SetVerification(value),
                    }.Build(),
                },
            }.Build(),
            Row{
                Children: []Blob{
                    (page.Button with{Label = "Back", OnClick = () -> donation.Back()}).Build(),
                    (page.Button with{Label = "Check selection & review", OnClick = () -> donation.Review(), Primary = true}).Build(),
                },
            }.Build(),
        }
    }
}
