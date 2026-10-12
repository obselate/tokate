package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The local checkout to set up, a summary, the control that writes the files and the report of the write.
data struct SetupReview {
    var Path string
    var Repository string
    var CommandCount int32
    var CheckCount int32
    var Contributors string
    var Harnesses string
    var Models string
    /// The time limit of a donation, or "" when the policy has none.
    var Limit string
    var Written string
    var Disabled bool
    var Compact bool
    var Button CommandButton
    var OnPath Action[string]?
    var OnApply Action?

    func Build() Blob {
        let facts = List[Blob]{
            DetailRow{Caption: "Repository", Value: Repository}.Build(),
            DetailRow{
                Caption: "Checks",
                Value: (CommandCount == 1 ? "1 command": CommandCount.ToString() + " commands") + ", " + (
                    CheckCount == 1 ? "1 CI check": CheckCount.ToString() + " CI checks"
                ),
            }.Build(),
            DetailRow{Caption: "Contributors", Value: Contributors}.Build(),
            DetailRow{Caption: "Harnesses", Value: Harnesses}.Build(),
            DetailRow{Caption: "Models", Value: Models}.Build(),
        }
        if Limit != "" {
            facts.Add(DetailRow{Caption: "Time limit", Value: Limit}.Build())
        }
        let review = Panel{
            Compact: Compact,
            Children: []Blob{
                IconHeading{
                    Icon: "folder_open",
                    Content: "Project setup",
                    Detail: "Tokate writes the policy and the workflow into your local checkout. Review the files and commit them.",
                }.Build(),
                InputField{
                    Label: "Local checkout",
                    Value: Path,
                    OnChange: OnPath,
                    Placeholder: "/path/to/project",
                    Width: 650,
                    Disabled: Disabled,
                }.Build(),
                Rule{}.Build(),
                Stack{Gap: 10, Children: facts.ToArray()}.Build(),
                Row{
                    Children: []Blob{
                        (Button with{Label = "Write setup files", OnClick = OnApply, Primary = true, Disabled = Path == ""}).Build(),
                    },
                }.Build(),
            },
        }.Build()
        if Written != "" {
            review.Children.Add(ReportText{Content: Written, MaxHeight: 420}.Build())
        }
        return review
    }
}
