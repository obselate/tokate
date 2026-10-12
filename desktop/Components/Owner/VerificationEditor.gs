package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct SetupEditorInput {
    var Owner OwnerService
    var Setup SetupDraft
    var Busy bool
    var Button CommandButton
    var Popup PopupInput
}

/// The project's verification commands, each run through `/bin/sh -c`. Holds the command being typed.
open class VerificationEditor : Cell[SetupEditorInput] {
    private var command string = ""

    protected override func Build(input SetupEditorInput) Blob {
        let owner = input.Owner
        let rows = List[Blob]{
            IconHeading{
                Icon: "checklist",
                Content: "Verification",
                Detail: "Tokate runs these commands to verify each contribution.",
            }.Build(),
        }
        let commands = input.Setup.Commands
        let lines = List[Blob]{Rule{}.Build()}
        for index in 0 ... commands.Length {
            let current = index
            lines.Add(
                Row{
                    Gap: 16,
                    Children: []Blob{
                        Container{
                            FlexGrow: 1,
                            FlexBasis: 0,
                            MinWidth: 200,
                            Label{Content: String.Join(" ", commands[index]), Mono: true}.Build(),
                        },
                        (input.Button with{
                            Label = "Remove",
                            Name = "Remove command " + (index + 1).ToString(),
                            Kind = ButtonKind.Quiet,
                            OnClick = () -> owner.RemoveCommand(current),
                        }).Build(),
                    },
                }.Build()
            )
            lines.Add(Rule{}.Build())
        }
        if lines.Count > 1 {
            rows.Add(Stack{Gap: 6, Children: lines.ToArray()}.Build())
        }
        rows.Add(
            Row{
                Align: AlignItems.FlexEnd,
                Children: []Blob{
                    InputField{
                        Label: "Command",
                        Value: command,
                        OnChange: value -> {
                            command = value
                        },
                        Placeholder: "dotnet test",
                        Width: 520,
                        Disabled: input.Busy,
                    }.Build(),
                    (input.Button with{
                        Label = "Add command",
                        OnClick = () -> {
                            owner.AddCommand(command)
                            command = ""
                        },
                        Disabled = String.IsNullOrWhiteSpace(command),
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: 18, Children: rows.ToArray()}.Build()
    }

    shared {
        func Mount(input SetupEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[SetupEditorInput, VerificationEditor]("verification", input)},
        }
    }
}
