package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// A selected saved run: the step it is at, who acts next, any failure and the actions it allows. The
/// action that the status calls for is first and primary.
data struct RunDetails {
    var Item SavedRun
    var Actions []RunAction
    var Button CommandButton
    var Compact bool
    /// A narrow panel names only the current step.
    var Narrow bool
    var Form Blob?
    /// What the coordinator does with a request of this run. The actions are disabled while `Waiting`.
    var Note Feedback
    var LastMessage string
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
            shown.Add(action)
        }
        if run.Pr > 0 {
            shown.Add(RunAction.Amend)
            shown.Add(RunAction.Reconcile)
        }
        var text = guide.Text
        if guide.Main != nil && !shown.Contains(guide.Main!!) {
            text = run.External ? "This contribution uses external work. Continue it with the Tokate command line.": "No action is available now. Refresh the status to see a change."
        }
        if text != "" {
            children.Add(Label{Content: text}.Build())
        }
        if run.ErrorMessage != "" {
            children.Add(Callout{Message: run.FailureReason + ": " + run.ErrorMessage + "\n" + CliError{Code: run.FailureReason}.Recovery, Tone: Tone.Fail}.Build())
        }
        if run.Warning != "" {
            children.Add(Callout{Message: run.Warning, Tone: Tone.Need}.Build())
        }
        if run.Guidance != "" {
            children.Add(Callout{Message: run.Guidance, Tone: Tone.Need}.Build())
        }
        if Note.Message != "" {
            children.Add(Callout{Message: Note.Message, Tone: Note.Tone}.Build())
        }
        var lead = guide.Main != nil ? shown.IndexOf(guide.Main!!): -1
        for index in 0 ... shown.Count {
            if lead < 0 && RunActions.Primary(shown[index]) {
                lead = index
            }
        }
        if lead > 0 {
            let first = shown[lead]
            shown.RemoveAt(lead)
            shown.Insert(0, first)
        }
        let buttons = List[Blob]()
        for index in 0 ... shown.Count {
            let selected = shown[index]
            buttons.Add(
                (Button with{
                    Label = RunActions.ButtonLabel(selected),
                    OnClick = () -> {
                        if selected == RunAction.Amend {
                            amend?.Invoke()
                        } else {
                            act?.Invoke(selected)
                        }
                    },
                    Primary = lead >= 0 && index == 0,
                    Disabled = Waiting,
                }).Build()
            )
        }
        if buttons.Count > 0 {
            children.Add(Row{Children: buttons.ToArray()}.Build())
        }
        for next in Item.Actions {
            let continuation = Array.IndexOf(next.Arguments, "--continue-from") >= 0
            if next.Command == "help" || (next.Command == "status" && Array.IndexOf(next.Arguments, "--run") < 0) || continuation {
                if continuation {
                    for command in []string{"pause", "resume"} {
                        let request = NextAction{Arguments: []string{"tokate", command, "--run", run.Path, "--json"}}
                        children.Add((Button with{
                            Label = command == "pause" ? "Pause stopped attempt": "Resume reservation",
                            Disabled = Waiting,
                            OnClick = () -> follow?.Invoke(request),
                        }).Build())
                    }
                }
                children.Add(Label{Content: String.Join(" ", next.Arguments)}.Build())
                children.Add((Button with{
                    Label = next.Command == "prepare" ? "Prepare continuation": next.Command == "help" ? "Read recovery help": "Inspect authority",
                    Disabled = Waiting,
                    OnClick = () -> follow?.Invoke(next),
                }).Build())
            }
        }
        let failure = String.Join("\n", run.Guidance, run.ErrorMessage, LastMessage)
        if failure.Contains("Tokate workflow failed.") || failure.Contains("GitHub could not start the Tokate workflow") {
            let recovery = NextAction{Arguments: []string{"tokate", "recover-request", run.Repo + "#" + run.Issue.ToString(), "--json"}}
            children.Add(Label{Content: "Only an owner with repository write access can recover the pending request. Fix the workflow cause first."}.Build())
            children.Add((Button with{
                Label = "Owner: recover request",
                Disabled = Waiting,
                OnClick = () -> follow?.Invoke(recovery),
            }).Build())
        }
        if let form = Form {
            children.Add(form)
        }
        return Panel{Compact: Compact, Children: children.ToArray()}.Build()
    }
}
