package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Coding and verification minutes within the owner's limit, and project network access.
data struct TimeLimits {
    var Draft DonationDraft
    var Policy Policy
    var Button CommandButton
    var Disabled bool
    var Compact bool
    var OnPreset Action[string]?
    var OnUnlimited Action[bool]?
    var OnCoding Action[string]?
    var OnVerification Action[string]?
    var OnNetwork Action[bool]?

    func Build() Container {
        let preset = OnPreset
        let labels = List[string]()
        let unavailable = List[bool]()
        var selected int32 = -1
        for i in 0 ... DonationState.Presets.Length {
            let minutes = DonationState.Presets[i]
            labels.Add(minutes + " min")
            unavailable.Add(!Draft.PresetAllowed(int32.Parse(minutes), Policy))
            if !Draft.Unlimited && Draft.Coding == minutes {
                selected = i
            }
        }
        let children = List[Blob]{
            IconHeading{Icon: "schedule", Content: "Time limits"}.Build(),
            PresetGroup{
                Button: Button,
                Labels: labels.ToArray(),
                Selected: selected,
                Unavailable: unavailable.ToArray(),
                OnChoose: index -> preset?.Invoke(DonationState.Presets[index]),
            }.Build(),
        }
        if Policy.MaxSeconds > 0 && !Draft.Unlimited {
            children.Add(
                Label{
                    Content: "Coding + verification limit: " + (Policy.MaxSeconds / 60).ToString() + " minutes.",
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build()
            )
        }
        if Policy.AllowsUnlimited {
            children.Add(Check{Label: "Unlimited coding time", Value: Draft.Unlimited, OnChange: OnUnlimited, Disabled: Disabled}.Build())
        }
        let budgets = List[Blob]()
        if !Draft.Unlimited {
            budgets.Add(InputField{Label: "Coding minutes", Value: Draft.Coding, OnChange: OnCoding, Width: 195, Disabled: Disabled}.Build())
        }
        budgets.Add(
            InputField{
                Label: "Verification minutes",
                Value: Draft.Verification,
                OnChange: OnVerification,
                Width: 195,
                Disabled: Disabled,
            }.Build()
        )
        children.Add(Row{Children: budgets.ToArray()}.Build())
        children.Add(Rule{}.Build())
        children.Add(
            Check{
                Label: "Allow project commands to use the network",
                Value: Draft.Network,
                OnChange: OnNetwork,
                Disabled: Disabled,
            }.Build()
        )
        return Panel{Compact: Compact, Name: "Time limit settings", Children: children.ToArray()}.Build()
    }
}
