package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The verification budget for recovery, or the whole amendment: the commit in the saved checkout that it
/// publishes, the public summary of the pull request for the donor to correct, who made the correction and
/// the budget. A checkout without a correction shows only how to make one.
data struct AmendmentForm {
    var Amendment AmendmentDraft
    var Run Run
    var Recovery bool
    var Stacked bool
    var Button CommandButton
    var Disabled bool
    /// The message about the latest action, which shows above the buttons.
    var Notice Feedback
    var OnVerification Action[string]?
    var OnSummary Action[PublicSummary]?
    var OnEdited Action[EditedBy]?
    var OnTools Action[string]?
    var OnOpenCheckout Action?
    var OnCheck Action?
    var OnPublish Action?
    var OnCancel Action?

    func Build() Blob {
        let budget = Row{
            Gap: 8,
            Children: []Blob{
                Label{Content: "Verify for at most"}.Build(),
                InputField{
                    Label: "Verification minutes",
                    Bare: true,
                    Value: Amendment.Verification,
                    OnChange: OnVerification,
                    Width: 80,
                    Disabled: Disabled,
                }.Build(),
                Label{Content: "minutes"}.Build(),
            },
        }.Build()
        if !Amendment.Open {
            return budget
        }
        let ready = Amendment.HasCorrection(Run.Commit)
        let children = List[Blob]{
            Rule{}.Build(),
            Section(
                "Amend the contribution",
                "Tokate verifies one commit from your saved checkout and adds it to the pull request. No inference runs."
            ),
        }
        if Amendment.Checked {
            children.Add(ready ? Commit(): Missing())
        }
        if ready {
            children.Add(Rule{}.Build())
            children.Add(Summary())
            children.Add(Rule{}.Build())
            children.Add(Editor())
            children.Add(Rule{}.Build())
        }
        if ready || Recovery {
            children.Add(budget)
        }
        if Notice.Message != "" {
            children.Add(Callout{Message: Notice.Message, Tone: Notice.Tone}.Build())
        }
        children.Add(
            Row{
                Children: []Blob{
                    (Button with{Label = "Verify and publish amendment", OnClick = OnPublish, Primary = true, Disabled = !ready}).Build(),
                    (Button with{Label = "Cancel", Kind = ButtonKind.Quiet, OnClick = OnCancel}).Build(),
                },
            }.Build()
        )
        return Stack{Gap: 18, Children: children.ToArray()}.Build()
    }

    private func Section(title string, detail string) Blob -> Stack{
        Gap: 4,
        Children: []Blob{
            Heading{Content: title, Size: AppTheme.ItemSize}.Build(),
            Label{Content: detail, Size: AppTheme.SmallSize, Muted: true}.Build(),
        },
    }.Build()

    private func Caption() Blob -> Label{Content: "Commit to publish", Size: AppTheme.SmallSize, Muted: true}.Build()

    private func OpenCheckout(kind ButtonKind) Blob -> (Button with{
        Label = "Open checkout folder",
        Kind = kind,
        Icon = "folder_open",
        AllowWhileBusy = true,
        OnClick = OnOpenCheckout,
        Disabled = Run.Checkout == "",
    }).Build()

    private func Commit() Blob -> Stack{
        Gap: 4,
        Children: []Blob{
            Caption(),
            Row{
                Children: []Blob{
                    Label{Content: Amendment.Commit.Substring(0, Math.Min(12, Amendment.Commit.Length)), Mono: true}.Build(),
                    Label{Content: Amendment.Subject}.Build(),
                },
            }.Build(),
            Row{
                Children: []Blob{
                    Label{
                        Content: (Amendment.Files == 1 ? "1 file": Amendment.Files.ToString() + " files") + " changed since the published commit",
                        Size: AppTheme.SmallSize,
                        Muted: true,
                    }.Build(),
                    OpenCheckout(ButtonKind.Quiet),
                },
            }.Build(),
        },
    }.Build()

    private func Missing() Blob {
        let steps = List[Blob]()
        for step in []string{
            "1. Open the checkout folder.",
            "2. Make the changes that the owner requested and commit them.",
            "3. Select \"Check again\".",
        } {
            steps.Add(Label{Content: step, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        return Stack{
            Gap: 12,
            Children: []Blob{
                Caption(),
                Label{Content: "The saved checkout has no new commit with file changes."}.Build(),
                Stack{Gap: 4, Children: steps.ToArray()}.Build(),
                Row{
                    Children: []Blob{
                        OpenCheckout(ButtonKind.Action),
                        (Button with{Label = "Check again", Icon = "refresh", OnClick = OnCheck}).Build(),
                    },
                }.Build(),
            },
        }.Build()
    }

    private func Summary() Blob {
        let summary = Amendment.Summary
        let change = OnSummary
        return Stack{
            Gap: 16,
            Children: []Blob{
                Section(
                    "Describe the complete change",
                    "These lines are the public summary of the pull request. Change them so they describe the result with your correction. Start each change with Add, Update, Remove or Fix."
                ),
                LineList{
                    Caption: "What changed  ·  1 to 8",
                    Name: "Change",
                    Lines: summary.Changes,
                    Limit: 8,
                    Placeholder: "Fix ...",
                    Button: Button,
                    Disabled: Disabled,
                    Problem: line -> PublicSummary.Problem(line),
                    OnChange: lines -> change?.Invoke(summary with{Changes = lines}),
                }.Build(),
                Columns{
                    Stacked: Stacked,
                    Children: []Blob{
                        LineList{
                            Caption: "How you verified it  ·  optional",
                            Name: "Result",
                            Lines: summary.Verification,
                            Limit: 8,
                            Placeholder: "A check and its result",
                            Button: Button,
                            Disabled: Disabled,
                            Problem: line -> PublicSummary.Problem(line),
                            OnChange: lines -> change?.Invoke(summary with{Verification = lines}),
                        }.Build(),
                        LineList{
                            Caption: "Limits  ·  optional",
                            Name: "Limit",
                            Lines: summary.Limitations,
                            Limit: 4,
                            Placeholder: "What was not tested",
                            Button: Button,
                            Disabled: Disabled,
                            Problem: line -> PublicSummary.Problem(line),
                            OnChange: lines -> change?.Invoke(summary with{Limitations = lines}),
                        }.Build(),
                    },
                }.Build(),
            },
        }.Build()
    }

    private func Editor() Blob {
        let edited = OnEdited
        let options = Run.DeclaresTool ? []EditedBy{EditedBy.Hand, EditedBy.Donation, EditedBy.Other}: []EditedBy{EditedBy.Hand, EditedBy.Other}
        let labels = List[string]()
        for option in options {
            labels.Add(
                switch option {
                    case EditedBy.Hand: "I edited the files by hand"
                    case EditedBy.Donation: "The tool of the donation: " + Run.Harness + ", " + Run.Model + " / " + Run.Effort
                    default: "Other tools, with a tool declarations file"
                }
            )
        }
        let children = List[Blob]{
            Heading{Content: "Who made the correction", Size: AppTheme.ItemSize}.Build(),
            Choices{
                Name: "Who made the correction",
                Labels: labels.ToArray(),
                Selected: Array.IndexOf(options, Amendment.Edited),
                OnChoose: index -> edited?.Invoke(options[index]),
                Disabled: Disabled,
            }.Build(),
        }
        if Amendment.Edited == EditedBy.Other {
            children.Add(
                InputField{
                    Label: "Tool declarations file",
                    Value: Amendment.Tools,
                    OnChange: OnTools,
                    Placeholder: "Path to a JSON file",
                    Width: 650,
                    Disabled: Disabled,
                }.Build()
            )
        }
        return Stack{Gap: 14, Children: children.ToArray()}.Build()
    }
}
