package TokateDesktop

import Goo
import System

/// Opens a repository the owner maintains, or checks owner prerequisites first.
data struct ProjectOpener {
    var Input string
    var Button CommandButton
    var Disabled bool
    var OnInput Action[string]?
    var OnOpen Action?
    var OnCheck Action?

    func Build() Blob -> Panel{
        Children: []Blob{
            Heading{Content: "Open a project", Size: 28}.Build(),
            InputField{
                Label: "GitHub repository",
                Value: Input,
                OnChange: OnInput,
                Placeholder: "owner/repository",
                Width: 540,
                Disabled: Disabled,
            }.Build(),
            Row{
                Children: []Blob{
                    (Button with{Label = "Open project", OnClick = OnOpen, Primary = true, Disabled = Input == ""}).Build(),
                    (Button with{Label = "Check owner prerequisites", OnClick = OnCheck}).Build(),
                },
            }.Build(),
        },
    }.Build()
}
