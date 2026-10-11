package TokateDesktop

import Goo
import System

/// The local checkout to set up, a summary, the control that writes the files and the report of the write.
data struct SetupReview {
    var Path string
    var Repository string
    var CommandCount int32
    var CheckCount int32
    var Written string
    var Disabled bool
    var Compact bool
    var Button CommandButton
    var OnPath Action[string]?
    var OnApply Action?

    func Build() Blob {
        let review = Panel{
            Compact: Compact,
            Children: []Blob{
                Heading{Content: "Project setup"}.Build(),
                InputField{
                    Label: "Local checkout",
                    Value: Path,
                    OnChange: OnPath,
                    Placeholder: "/path/to/project",
                    Width: 650,
                    Disabled: Disabled,
                }.Build(),
                DetailRow{Caption: "Repository", Value: Repository}.Build(),
                DetailRow{
                    Caption: "Checks",
                    Value: CommandCount.ToString() + " commands, " + CheckCount.ToString() + " CI checks",
                }.Build(),
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
