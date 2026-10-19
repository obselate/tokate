package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// A selected saved run and its next actions, with the primary action last.
data struct RunDetails {
    var Item SavedRun
    var Actions []RunAction
    var Button CommandButton
    /// A narrow panel names only the current step.
    var Narrow bool
    var Form Blob?
    var Waiting bool
    var OnAction Action[RunAction]?
    var OnToggleAmendment Action?
    var OnFollow Action[NextAction]?

    func Build() Blob {
        let act = OnAction
        let amend = OnToggleAmendment
        let follow = OnFollow
        let run = Item.Run ?? Run.Empty
        let status = Item.Status()
        let tone = Statuses.ToneOf(status)
        let look = AppTheme.Look(tone)
        let finished = status == "Merged" || status == "Closed without merge"
        let blocked = run.OwnerRecovery
        let guide = RunGuide.For(status, run.Pr > 0)
        let children = List[Blob]{
            Progression{Names: RunGuide.Steps, Current: guide.Step, State: tone, Narrow: Narrow}.Build(),
            Rule{}.Build(),
            Row{
                NoWrap: true,
                Align: AlignItems.FlexStart,
                Children: []Blob{
                    tone == Tone.Wait ? WaitMark.Mount("run-wait", WaitMarkInput{Icon: look.Icon, Size: 26, Ink: look.Edge}): MaterialIcons.Create(
                        look.Icon == "" ? "arrow_circle_right": look.Icon,
                        26,
                        look.Edge
                    ),
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Heading{Content: guide.Heading}.Build()},
                },
            }.Build(),
        }
        let shown = List[RunAction]()
        for action in Actions {
            if finished || blocked {
                continue
            }
            shown.Add(action)
        }
        if !finished && !blocked && (run.Pr > 0 || !run.External && (run.State == "generated" || run.FailureReason == "verification_failed")) {
            if !shown.Contains(RunAction.Amend) {
                shown.Add(RunAction.Amend)
            }
        }
        var text = guide.Text
        if guide.Main != nil && !shown.Contains(guide.Main!!) {
            text = run.External ? "Continue external work with the Tokate CLI.": "Refresh status to check the next action."
        }
        if text != "" {
            children.Add(Label{Content: text}.Build())
        }
        var lead = guide.Main != nil ? shown.IndexOf(guide.Main!!): -1
        for index in 0 ... shown.Count {
            if lead < 0 && RunActions.Primary(shown[index]) {
                lead = index
            }
        }
        if lead >= 0 && lead < shown.Count - 1 {
            let primary = shown[lead]
            shown.RemoveAt(lead)
            shown.Add(primary)
        }
        let buttons = List[Blob]()
        for index in 0 ... shown.Count {
            let selected = shown[index]
            buttons.Add(
                (Button with{
                    Label = selected == RunAction.Submit && run.Gratis ? "Review pull request": RunActions.ButtonLabel(selected),
                    OnClick = () -> {
                        if selected == RunAction.Amend {
                            amend?.Invoke()
                        } else {
                            act?.Invoke(selected)
                        }
                    },
                    Primary = Form == nil && lead >= 0 && index == shown.Count - 1,
                    Tone = selected == RunAction.Submit || selected == RunAction.Amend ? ButtonTone.Positive: ButtonTone.Default,
                    Disabled = Waiting,
                }).Build()
            )
        }
        if buttons.Count > 0 {
            children.Add(ActionBar{Children: buttons.ToArray()}.Build())
        }
        for next in Item.Actions {
            let continuation = Array.IndexOf(next.Arguments, "--continue-from") >= 0
            if finished || blocked {
                continue
            }
            if next.Command == "help" || (next.Command == "status" && !next.NamesRun && Array.IndexOf(next.Arguments, "--run") < 0) || continuation {
                let followButtons = List[Blob]()
                if continuation {
                    for command in []string{"pause", "resume"} {
                        let request = NextAction{Arguments: []string{"tokate", command, "--run", run.Path, "--json"}}
                        followButtons.Add((Button with{
                            Label = command == "pause" ? "Pause stopped attempt": "Resume reservation",
                            Disabled = Waiting,
                            OnClick = () -> follow?.Invoke(request),
                        }).Build())
                    }
                }
                children.Add(Label{Content: continuation ? "Continue saved work with a new time budget.": next.Command == "help" ? "Read recovery instructions before another attempt.": "Check the current approval and permissions."}.Build())
                followButtons.Add((Button with{
                    Label = continuation ? "Continue with a new budget": next.Command == "help" ? "Read failure help": "Inspect authority",
                    Disabled = Waiting,
                    Primary = Form == nil && continuation && lead < 0,
                    OnClick = () -> follow?.Invoke(next),
                }).Build())
                children.Add(ActionBar{Children: followButtons.ToArray()}.Build())
            }
        }
        if let form = Form {
            children.Add(form)
        }
        return Panel{Children: children.ToArray()}.Build()
    }
}

data struct PullRequestReview {
    var Preview PullRequestPreview
    var Button CommandButton
    var OnPublish Action?
    var Narrow bool

    func Build() Blob -> Panel{
        Name: "Pull request review",
        Children: []Blob{
            Progression{Names: RunGuide.Steps, Current: 2, State: Tone.Need, Narrow: Narrow}.Build(),
            Rule{}.Build(),
            Heading{Content: Preview.Title}.Build(),
            DetailRow{Caption: "Branches", Value: Preview.Base + " <- " + Preview.Head}.Build(),
            Text{
                Content: Preview.Body,
                FontFamily: AppTheme.BodyFont,
                FontSize: AppTheme.BodySize,
                Color: AppTheme.Current.Ink,
                MaxHeight: AppTheme.ReportMaxHeight,
                OverflowY: Overflow.Scroll,
                Focusable: true,
                Focus: AppTheme.FocusStyle(),
            },
            ActionBar{Children: []Blob{
                (Button with{Label = "Publish pull request", Primary = true, Tone = ButtonTone.Positive, OnClick = OnPublish}).Build(),
            }}.Build(),
        },
    }.Build()
}
