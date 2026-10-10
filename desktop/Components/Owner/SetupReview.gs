package TokateDesktop

import Goo
import System

/// The local checkout to set up, a summary, and the preview-then-apply controls.
data struct SetupReview {
    var Path string
    var Repository string
    var CommandCount int32
    var CheckCount int32
    var Preview SetupPreview
    var Disabled bool
    var Compact bool
    var Button CommandButton
    var OnPath Action[string]?
    var OnPreview Action?
    var OnApply Action?

    func Build() Blob {
        let review = Panel{
            Compact: Compact,
            Children: []Blob{
                Heading{Content: "Project setup", Size: 28}.Build(),
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
                        (Button with{Label = "Preview setup", OnClick = OnPreview, Primary = true, Disabled = Path == ""}).Build(),
                        (Button with{Label = "Apply preview", OnClick = OnApply, Disabled = !Preview.Ready}).Build(),
                    },
                }.Build(),
            },
        }.Build()
        if Preview.Text != "" {
            review.Children.Add(ReportText{Content: Preview.Text, Size: 14, MaxHeight: 420}.Build())
        }
        return review
    }
}
