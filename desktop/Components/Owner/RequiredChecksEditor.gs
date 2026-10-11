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
            tags.Add((input.Button with{Label = check, Icon = "close", OnClick = () -> owner.RemoveCheck(selected)}).Build())
        }
        return Stack{
            Gap: 18,
            Children: []Blob{
                Heading{Content: "Required CI checks"}.Build(),
                Row{Children: tags.ToArray()}.Build(),
                Row{
                    Children: []Blob{
                        InputField{
                            Label: "Check name",
                            Value: name,
                            OnChange: value -> {
                                name = value
                            },
                            Placeholder: "build",
                            Width: 360,
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
                }.Build(),
            },
        }.Build()
    }

    shared {
        func Mount(input SetupEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[SetupEditorInput, RequiredChecksEditor]("required-checks", input)},
        }
    }
}
