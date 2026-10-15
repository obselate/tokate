package TokateDesktop

import Goo
import System

/// Total task time includes its reserved verification share.
data struct TimeLimits {
    var Draft DonationDraft
    var Policy Policy
    var Button CommandButton
    var Disabled bool
    var OnUnlimited Action[bool]?
    var OnCoding Action[string]?
    var OnVerification Action[string]?

    func Build() Container {
        let total = int32.Parse(Draft.Coding) + Draft.ReserveMinutes()
        return Panel{Name: "Time limit settings", Children: []Blob{
            IconHeading{Icon: "schedule", Content: "Time"}.Build(),
            TimeBudget{Caption: "Per task", Minutes: total, Minimum: 2, Maximum: Policy.MaxSeconds > 0 ? Policy.MaxSeconds / 60: 0, Hint: Policy.MaxSeconds > 0 ? "Up to " + DonationState.Duration(Policy.MaxSeconds / 60): "No repository limit", Disabled: Disabled || Draft.Unlimited, Button: Button, OnChange: OnCoding}.Build(),
            TimeBudget{Caption: "Verification share", Minutes: Draft.ReserveMinutes(), Minimum: 1, Maximum: total - 1, Hint: "Reserved within the per-task time.", Disabled: Disabled, Button: Button, OnChange: OnVerification}.Build(),
            Policy.AllowsUnlimited ? Check{Label: "Unlimited coding", Value: Draft.Unlimited, OnChange: OnUnlimited, Disabled: Disabled}.Build(): Container{},
        }}.Build()
    }
}
