package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct SetupEditorInput {
    var Owner OwnerService
    var Setup SetupDraft
    var Busy bool
    var Button CommandButton
}

/// The project's verification commands, each run through `/bin/sh -c`. Holds the command being typed.
open class VerificationEditor : Cell[SetupEditorInput] {
    private var command string = ""

    protected override func Build(input SetupEditorInput) Blob {
        let owner = input.Owner
        let rows = List[Blob]{Heading{Content: "Verification"}.Build()}
        let commands = input.Setup.Commands
        for index in 0 ... commands.Length {
            let current = index
            rows.Add(
                Row{
                    Children: []Blob{
                        Label{Content: String.Join(" ", commands[index]), Mono: true}.Build(),
                        (input.Button with{
                            Label = "Remove command " + (index + 1).ToString(),
                            OnClick = () -> owner.RemoveCommand(current),
                        }).Build(),
                    },
                }.Build()
            )
        }
        rows.Add(
            Row{
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
