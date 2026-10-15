package TokateDesktop

import Goo
import System

/// Opens a run directory that Tokate printed.
data struct RunOpener {
    var Path string
    var Button CommandButton
    var Disabled bool
    var OnPath Action[string]?
    var OnOpen Action?

    func Build() Blob -> Panel{
        Children: []Blob{
            Row{
                Children: []Blob{
                    InputField{
                        Label: "Run directory",
                        Value: Path,
                        OnChange: OnPath,
                        Placeholder: "Path printed by Tokate",
                        Width: AppTheme.WideFieldWidth,
                        Disabled: Disabled,
                    }.Build(),
                    (Button with{Label = "Open run", OnClick = OnOpen, Primary = true, Disabled = Path == ""}).Build(),
                },
            }.Build(),
        },
    }.Build()
}
