package TokateDesktop

import Goo
import System
import System.Collections.Generic

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
        let item = state.Chosen
        let links = List[Blob]{
            (page.Button with{
                Label = "Open issue",
                Kind = ButtonKind.Quiet,
                Icon = "open_in_new",
                AllowWhileBusy = true,
                OnClick = () -> Browser.Open("https://github.com/" + run.Repo + "/issues/" + run.Issue.ToString()),
            }).Build(),
        }
        if run.Pr > 0 {
            links.Add(
                (page.Button with{
                    Label = "Open pull request",
                    Kind = ButtonKind.Quiet,
                    Icon = "open_in_new",
                    AllowWhileBusy = true,
                    OnClick = () -> Browser.Open("https://github.com/" + run.Repo + "/pull/" + run.Pr.ToString()),
                }).Build()
            )
        }
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
            PageTitle{
                Title: item.Title == "" ? run.Identity: item.Title,
                Caption: item.Title == "" ? "": run.Identity,
                Links: links.ToArray(),
                Trailing: StatusBadge{Value: item.Status(), Tone: Statuses.ToneOf(item.Status())}.Build(),
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
