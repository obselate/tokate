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

    /// True when the amendment form is open, which then holds the message about the latest action.
    prop HoldsNotice bool -> saved.Current.Amendment.Open

    func Build(page PageContext, notice Feedback) []Blob {
        let state = saved.Current
        let run = state.Run
        let amendment = state.Amendment
        let form Blob? = amendment.Open ? AmendmentForm{
            Amendment: amendment,
            Run: run,
            Stacked: page.NarrowContent,
            Button: page.Button,
            Disabled: page.Busy,
            Notice: notice,
            OnVerification: value -> saved.SetVerification(value),
            OnSummary: value -> saved.SetSummary(value),
            OnEdited: value -> saved.SetEdited(value),
            OnTools: value -> saved.SetTools(value),
            OnOpenCheckout: () -> saved.OpenCheckout(),
            OnCheck: () -> saved.ReadCorrection(),
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
                Stacked: page.NarrowContent,
            }.Build(),
            RunDetails{
                Item: state.Chosen,
                Actions: state.Actions,
                Button: page.Button,
                Narrow: page.NarrowContent,
                Form: form,
                Note: state.Note,
                LastMessage: notice.Message,
                Waiting: state.Waiting,
                OnAction: action -> saved.Act(action),
                OnToggleAmendment: () -> saved.ToggleAmendment(),
                OnFollow: action -> saved.Follow(action),
            }.Build(),
            RunFacts{Item: state.Chosen, Stacked: page.Metrics.ContentWidth < AppTheme.ColumnsBreakpoint}.Build(),
        }
    }
}
