package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The verification budget for recovery or an amendment, and the amendment's commit and optional files.
data struct AmendmentForm {
    var Amendment AmendmentDraft
    var Button CommandButton
    var Disabled bool
    var OnVerification Action[string]?
    var OnCommit Action[string]?
    var OnSummary Action[string]?
    var OnTools Action[string]?
    var OnPublish Action?

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
            children.Add(
                InputField{Label: "Candidate commit", Value: Amendment.Commit, OnChange: OnCommit, Width: 650, Disabled: Disabled}.Build()
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
            children.Add((Button with{Label = "Verify and publish amendment", OnClick = OnPublish, Primary = true}).Build())
        }
        return Stack{Gap: 18, Children: children.ToArray()}.Build()
    }
}
