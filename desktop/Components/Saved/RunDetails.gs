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
    var Form Blob?
    var OnAction Action[RunAction]?
    var OnToggleAmendment Action?

    func Build() Blob {
        let act = OnAction
        let amend = OnToggleAmendment
        let run = Item.Run ?? Run.Empty
        let status = Item.Status()
        let tone = Statuses.ToneOf(status)
        let look = AppTheme.Look(tone)
        let guide = RunGuide.For(status, run.Pr > 0)
        let children = List[Blob]{
            Progression{Names: RunGuide.Steps, Current: guide.Step, State: tone}.Build(),
            Rule{}.Build(),
            Row{
                Children: []Blob{
                    MaterialIcons.Create(look.Icon == "" ? "arrow_circle_right": look.Icon, 26, look.Edge),
                    Heading{Content: guide.Heading}.Build(),
                },
            }.Build(),
        }
        if guide.Text != "" {
            children.Add(Label{Content: guide.Text}.Build())
        }
        if run.ErrorMessage != "" {
            children.Add(Callout{Message: run.ErrorMessage, Tone: Tone.Fail}.Build())
        }
        let shown = List[RunAction]()
        for action in Actions {
            shown.Add(action)
        }
        if run.Pr > 0 {
            shown.Add(RunAction.Amend)
            shown.Add(RunAction.Reconcile)
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
                }).Build()
            )
        }
        if buttons.Count > 0 {
            children.Add(Row{Children: buttons.ToArray()}.Build())
        }
        if let form = Form {
            children.Add(form)
        }
        return Panel{Compact: Compact, Children: children.ToArray()}.Build()
    }
}
