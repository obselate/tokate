package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The verification budget for recovery or an amendment. An amendment also shows the commit at HEAD of the
/// saved checkout, which it publishes, and takes optional files.
data struct AmendmentForm {
    var Amendment AmendmentDraft
    var Checkout string
    var Published string
    var Button CommandButton
    var Disabled bool
    var OnVerification Action[string]?
    var OnSummary Action[string]?
    var OnTools Action[string]?
    var OnPublish Action?
    var OnCancel Action?

    func Build() Blob {
        let children = List[Blob]{
            InputField{
                Label: "Verification minutes",
                Value: Amendment.Verification,
                OnChange: OnVerification,
                Width: 220,
                Disabled: Disabled,
            }.Build(),
        }
        if Amendment.Open {
            let ready = Amendment.HasCorrection(Published)
            children.Add(DetailRow{Caption: "Saved checkout", Value: Checkout, Mono: true}.Build())
            children.Add(
                DetailRow{
                    Caption: "Commit to publish",
                    Value: ready ? Amendment.Commit.Substring(0, Math.Min(12, Amendment.Commit.Length)) + "  " + Amendment.Subject: "No file changes to publish. Edit and commit the correction in the saved checkout, then open this form again.",
                }.Build()
            )
            children.Add(
                InputField{
                    Label: "Public summary file",
                    Value: Amendment.Summary,
                    OnChange: OnSummary,
                    Placeholder: "Optional path",
                    Width: 650,
                    Disabled: Disabled,
                }.Build()
            )
            children.Add(
                InputField{
                    Label: "Tool declarations file",
                    Value: Amendment.Tools,
                    OnChange: OnTools,
                    Placeholder: "Optional path",
                    Width: 650,
                    Disabled: Disabled,
                }.Build()
            )
            children.Add(
                Row{
                    Children: []Blob{
                        (Button with{Label = "Verify and publish amendment", OnClick = OnPublish, Primary = true, Disabled = !ready}).Build(),
                        (Button with{Label = "Cancel", Kind = ButtonKind.Quiet, OnClick = OnCancel}).Build(),
                    },
                }.Build()
            )
        }
        return Stack{Gap: 18, Children: children.ToArray()}.Build()
    }
}
