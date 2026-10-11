package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// A selected saved run: its model, any failure, the actions it allows, and links to GitHub.
data struct RunDetails {
    var Run Run
    var Actions []RunAction
    var Button CommandButton
    var Compact bool
    var Form Blob?
    var OnAction Action[RunAction]?
    var OnToggleAmendment Action?
    var OnOpenPullRequest Action?
    var OnOpenIssue Action?

    func Build() Blob {
        let act = OnAction
        let children = List[Blob]{
            Heading{Content: Run.Identity}.Build(),
            DetailRow{Caption: "Model", Value: Run.Model + " / " + Run.Effort}.Build(),
        }
        if Run.ErrorMessage != "" {
            children.Add(Callout{Message: Run.ErrorMessage, Tone: Tone.Fail}.Build())
        }
        let buttons = List[Blob]()
        for action in Actions {
            let selected = action
            buttons.Add(
                (Button with{
                    Label = RunActions.ButtonLabel(action),
                    OnClick = () -> act?.Invoke(selected),
                    Primary = RunActions.Primary(action),
                }).Build()
            )
        }
        if Run.Pr > 0 {
            buttons.Add((Button with{Label = "Amend contribution", OnClick = OnToggleAmendment}).Build())
            buttons.Add((Button with{Label = "Update workspace", OnClick = () -> act?.Invoke(RunAction.Reconcile)}).Build())
            buttons.Add((Button with{Label = "Open pull request", Kind = ButtonKind.Quiet, Icon = "open_in_new", OnClick = OnOpenPullRequest}).Build())
        }
        buttons.Add((Button with{Label = "Open issue", Kind = ButtonKind.Quiet, Icon = "open_in_new", OnClick = OnOpenIssue}).Build())
        children.Add(Row{Children: buttons.ToArray()}.Build())
        if let form = Form {
            children.Add(form)
        }
        return Panel{Compact: Compact, Children: children.ToArray()}.Build()
    }
}
