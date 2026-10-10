package TokateDesktop

import Goo
import System

data struct GrantAccessInput {
    var Owner OwnerService
    var CanWrite bool
    var Busy bool
    var Compact bool
    var Button CommandButton
}

/// Grants a donor access to one issue, or trusts them for every issue. Holds the typed donor and issue. Mounted in its own container so it can sit among unkeyed siblings.
open class GrantAccessForm : Cell[GrantAccessInput] {
    private var donor string = ""
    private var issue string = ""

    protected override func Build(input GrantAccessInput) Blob {
        let owner = input.Owner
        let valid = int32.TryParse(issue, out var number) && number >= 1
        return Panel{
            Compact: input.Compact,
            Children: []Blob{
                Heading{Content: "Grant access", Size: 28}.Build(),
                Row{
                    Children: []Blob{
                        InputField{
                            Label: "Donor",
                            Value: donor,
                            OnChange: value -> {
                                donor = value
                            },
                            Placeholder: "GitHub username",
                            Width: 280,
                            Disabled: input.Busy,
                        }.Build(),
                        InputField{
                            Label: "Issue",
                            Value: issue,
                            OnChange: value -> {
                                issue = value
                            },
                            Placeholder: "Issue number",
                            Width: 180,
                            Disabled: input.Busy,
                        }.Build(),
                    },
                }.Build(),
                Row{
                    Children: []Blob{
                        (input.Button with{
                            Label = "Grant issue access",
                            OnClick = () -> owner.ChangeAccess("grant", donor, issue),
                            Primary = true,
                            Disabled = !input.CanWrite || donor == "" || !valid,
                        }).Build(),
                        (input.Button with{
                            Label = "Trust donor",
                            OnClick = () -> owner.ChangeAccess("trust", donor),
                            Disabled = !input.CanWrite || donor == "",
                        }).Build(),
                    },
                }.Build(),
            },
        }.Build()
    }

    shared {
        func Mount(input GrantAccessInput) Blob -> Container{
            Children: []Blob{Cell.Mount[GrantAccessInput, GrantAccessForm]("grant-access", input)},
        }
    }
}
