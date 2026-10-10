package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Step II: the coding tool, model and time limits.
class LimitsStepView {
    private let donation DonationService

    init(donation DonationService) {
        this.donation = donation
    }

    func Build(page PageContext) []Blob {
        let state = donation.Current
        let draft = state.Draft
        let tools = List[Blob]{
            Heading{Content: "Coding tool", Size: 28}.Build(),
            HarnessPicker{Selected: draft.Harness, Disabled: page.Busy, OnChoose: id -> donation.ChooseHarness(id)}.Build(),
        }
        if state.Profiles.Length > 0 {
            tools.Add(
                ProfileButtons{
                    Profiles: state.Profiles,
                    Button: page.Button,
                    OnUse: profile -> donation.UseProfile(profile),
                }.Build()
            )
        }
        if draft.Profile != "" {
            tools.Add(DetailRow{Caption: "Profile", Value: draft.Profile}.Build())
        }
        tools.Add(
            ModelPicker{
                Harness: draft.Harness,
                Model: draft.Model,
                Effort: draft.Effort,
                Endpoint: draft.Endpoint,
                Models: state.Models,
                Efforts: state.Efforts(),
                Disabled: page.Busy,
                OnModel: value -> donation.SetModel(value),
                OnEffort: value -> donation.SetEffort(value),
                OnEndpoint: value -> donation.SetEndpoint(value),
                OnPopupKey: page.OnPopupKey,
                OnPopupPointer: page.OnPopupPointer,
            }.Build()
        )
        return []Blob{
            Heading{Content: state.Identity + "  " + state.IssueTitle, Size: 27}.Build(),
            CardColumns{
                Stacked: page.Metrics.ContentWidth < 740,
                Cards: []Container{
                    Panel{Compact: page.CompactPanels, Name: "Coding tool settings", Children: tools.ToArray()}.Build(),
                    TimeLimits{
                        Draft: draft,
                        Policy: state.Policy,
                        Button: page.Button,
                        Disabled: page.Busy,
                        Compact: page.CompactPanels,
                        OnPreset: minutes -> donation.ChoosePreset(minutes),
                        OnUnlimited: value -> donation.SetUnlimited(value),
                        OnCoding: value -> donation.SetCoding(value),
                        OnVerification: value -> donation.SetVerification(value),
                        OnNetwork: value -> donation.SetNetwork(value),
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
