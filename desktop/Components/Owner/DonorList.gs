package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct DonorListInput {
    var Owner OwnerService
    var Members []AccessMember
    var CanWrite bool
    var Busy bool
    var Button CommandButton
}

/// The donors with access, one line for each, with the owner's trust and deny actions. "Add donor" opens a
/// row that grants a donor access to one issue or trusts them for every issue. Holds the typed donor and
/// issue. Mounted in its own container so it can sit among unkeyed siblings.
open class DonorList : Cell[DonorListInput] {
    private var adding bool
    private var donor string = ""
    private var issue string = ""

    protected override func Build(input DonorListInput) Blob {
        let owner = input.Owner
        let lines = List[Blob]()
        if adding {
            let valid = int32.TryParse(issue, out var number) && number >= 1
            let form = ListRow{
                Children: []Blob{
                    InputField{
                        Label: "Donor",
                        Value: donor,
                        OnChange: value -> {
                            donor = value
                        },
                        Placeholder: "GitHub username",
                        Width: AppTheme.ShortFieldWidth,
                        Disabled: input.Busy,
                    }.Build(),
                    StatusChip{Value: issue == "" ? "Choose an issue below": "Issue #" + issue, Tone: Tone.Wait}.Build(),
                    (input.Button with{
                        Label = "Grant issue access",
                        OnClick = () -> owner.ChangeAccess("grant", donor, issue),
                        Primary = true,
                        Tone = ButtonTone.Positive,
                        Disabled = !input.CanWrite || donor == "" || !valid,
                    }).Build(),
                    (input.Button with{
                        Label = "Trust for all issues",
                        Name = "Trust donor",
                        Tone = ButtonTone.Positive,
                        OnClick = () -> owner.ChangeAccess("trust", donor),
                        Disabled = !input.CanWrite || donor == "",
                    }).Build(),
                },
            }.Build()
            form.AlignItems = AlignItems.FlexEnd
            form.Padding = Edges{Left: AppTheme.Space24, Right: AppTheme.Space12, Top: AppTheme.Space12, Bottom: AppTheme.Space16}
            form.BackgroundColor = AppTheme.Current.Paper
            lines.Add(form)
            let choices = List[Blob]()
            for item in owner.Issues.Current.Rows {
                let selected = item.NumberText
                choices.Add(ListRow{
                    Name: "Choose issue #" + selected,
                    Disabled: input.Busy,
                    OnChoose: () -> {
                        issue = selected
                        Rebuild()
                    },
                    Children: []Blob{
                        StatusChip{Value: issue == selected ? "Selected": "#" + selected, Tone: issue == selected ? Tone.Done: Tone.Wait}.Build(),
                        Label{Content: item.Title}.Build(),
                    },
                }.Build())
            }
            lines.Add(ListSection{Title: "Choose an issue", Count: owner.Issues.Current.Total, Children: choices.ToArray()}.Build())
            lines.Add(IssuePager{
                Listing: owner.Issues.Current, Button: input.Button,
                OnPage: number -> owner.Issues.Search(number),
            }.Build())
        }
        for member in input.Members {
            let name = member.Donor
            let trust = member.Trusted ? "untrust": "trust"
            let deny = member.Denied ? "restore": "deny"
            lines.Add(
                ListRow{
                    Children: []Blob{
                        Row{Gap: AppTheme.Space8, NoWrap: true, Children: []Blob{
                            Label{Content: name}.Build(),
                            StatusChip{Value: member.Badge, Tone: Statuses.ToneOf(member.Badge)}.Build(),
                        }}.Build(),
                        Spacer{}.Build(),
                        (input.Button with{
                            Label = member.Trusted ? "Untrust": "Trust",
                            Name = (member.Trusted ? "Untrust ": "Trust ") + name,
                            Tone = member.Trusted ? ButtonTone.Danger: ButtonTone.Positive,
                            OnClick = () -> owner.ChangeAccess(trust, name),
                            Disabled = !input.CanWrite,
                        }).Build(),
                        (input.Button with{
                            Label = member.Denied ? "Restore": "Deny",
                            Name = (member.Denied ? "Restore ": "Deny ") + name,
                            Tone = member.Denied ? ButtonTone.Positive: ButtonTone.Danger,
                            OnClick = () -> owner.ChangeAccess(deny, name),
                            Disabled = !input.CanWrite,
                        }).Build(),
                    },
                }.Build()
            )
        }
        if input.Members.Length == 0 {
            lines.Add(ListRow{Children: []Blob{Label{Content: "No donors have access", Muted: true}.Build()}}.Build())
        }
        return ListSection{
            Title: "Donors",
            Count: input.Members.Length,
            Trailing: []Blob{
                (input.Button with{
                    Label = adding ? "Cancel": "Add donor",
                    Icon = adding ? "close": "add",
                    AllowWhileBusy = true,
                    OnClick = () -> {
                        adding = !adding
                        Rebuild()
                    },
                }).Build(),
            },
            Children: lines.ToArray(),
        }.Build()
    }

    shared {
        func Mount(input DonorListInput) Blob -> Container{
            Children: []Blob{Cell.Mount[DonorListInput, DonorList]("donors", input)},
        }
    }
}
