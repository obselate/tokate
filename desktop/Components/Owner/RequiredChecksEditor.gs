package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The CI checks a pull request must pass. Holds the check name being typed.
open class RequiredChecksEditor : Cell[SetupEditorInput] {
    private var name string = ""

    protected override func Build(input SetupEditorInput) Blob {
        let owner = input.Owner
        let tags = List[Blob]()
        for check in input.Setup.Checks {
            let selected = check
            tags.Add((input.Button with{Label = check, Tone = ButtonTone.Danger, Icon = "close", OnClick = () -> owner.RemoveCheck(selected)}).Build())
        }
        let rows = List[Blob]{
            IconHeading{
                Icon: "verified",
                Content: "Required CI checks",
                Detail: "Checks required on each pull request",
            }.Build(),
        }
        if tags.Count > 0 {
            rows.Add(Row{Children: tags.ToArray()}.Build())
        }
        rows.Add(
            Row{
                Align: AlignItems.FlexEnd,
                Children: []Blob{
                    InputField{
                        Label: "Check name",
                        Value: name,
                        OnChange: value -> {
                            name = value
                        },
                        Placeholder: "build",
                        Width: AppTheme.FieldWidth,
                        Disabled: input.Busy,
                    }.Build(),
                    (input.Button with{
                        Label = "Add check",
                        OnClick = () -> {
                            owner.AddCheck(name)
                            name = ""
                        },
                        Disabled = String.IsNullOrWhiteSpace(name),
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: AppTheme.Space16, Children: rows.ToArray()}.Build()
    }

    shared {
        func Mount(input SetupEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[SetupEditorInput, RequiredChecksEditor]("required-checks", input)},
        }
    }
}
