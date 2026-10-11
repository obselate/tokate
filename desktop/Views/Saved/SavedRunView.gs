package TokateDesktop

import Goo
import System

/// The selected saved run and what can be done with it next.
class SavedRunView {
    private let saved SavedWorkService

    init(saved SavedWorkService) {
        this.saved = saved
    }

    func Build(page PageContext) []Blob {
        let state = saved.Current
        let run = state.Run
        let amendment = state.Amendment
        let form Blob? = Array.IndexOf(state.Actions, RunAction.Recover) >= 0 || amendment.Open ? AmendmentForm{
            Amendment: amendment,
            Button: page.Button,
            Disabled: page.Busy,
            OnVerification: value -> saved.SetVerification(value),
            OnCommit: value -> saved.SetCommit(value),
            OnSummary: value -> saved.SetSummary(value),
            OnTools: value -> saved.SetTools(value),
            OnPublish: () -> saved.Act(RunAction.Amend),
            OnCancel: () -> saved.ToggleAmendment(),
        }.Build(): nil
        return []Blob{
            Row{
                Children: []Blob{
                    (page.Button with{
                        Label = "Back to contributions",
                        Kind = ButtonKind.Quiet,
                        Icon = "arrow_back",
                        IconFirst = true,
                        OnClick = () -> saved.Back(),
                    }).Build(),
                    Spacer{}.Build(),
                    (page.Button with{
                        Label = "Refresh status",
                        Kind = ButtonKind.Quiet,
                        Icon = "refresh",
                        OnClick = () -> saved.LoadRun(),
                    }).Build(),
                },
            }.Build(),
            RunHeader{
                Item: state.Chosen,
                Button: page.Button,
                OnOpenIssue: () -> Browser.Open("https://github.com/" + run.Repo + "/issues/" + run.Issue.ToString()),
                OnOpenPullRequest: () -> Browser.Open("https://github.com/" + run.Repo + "/pull/" + run.Pr.ToString()),
            }.Build(),
            RunDetails{
                Item: state.Chosen,
                Actions: state.Actions,
                Button: page.Button,
                Compact: page.CompactPanels,
                Form: form,
                OnAction: action -> saved.Act(action),
                OnToggleAmendment: () -> saved.ToggleAmendment(),
            }.Build(),
            RunFacts{Item: state.Chosen, Compact: page.CompactPanels, Stacked: page.NarrowContent}.Build(),
        }
    }
}
