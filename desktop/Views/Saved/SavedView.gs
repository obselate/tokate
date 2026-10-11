package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved work page: the list of saved runs, or the selected run, below the actions for that view.
class SavedView {
    private let saved SavedWorkService
    private let feedback FeedbackService
    private let list SavedListView
    private let details SavedRunView

    init(saved SavedWorkService, feedback FeedbackService) {
        this.saved = saved
        this.feedback = feedback
        list = SavedListView(saved)
        details = SavedRunView(saved)
    }

    prop IsBrowsing bool -> saved.Current.Browsing

    func Build(page PageContext) Blob {
        let state = saved.Current
        let body = List[Blob]{
            Heading{Content: "Saved work", Size: AppTheme.DisplaySize}.Build(),
            Row{
                Children: state.Selected ? []Blob{
                    (page.Button with{Label = "Back to contributions", OnClick = () -> saved.Back()}).Build(),
                    (page.Button with{Label = "Refresh status", OnClick = () -> saved.LoadRun()}).Build(),
                }: []Blob{
                    (page.Button with{
                        Label = state.Reading ? "Stop updating": state.Loaded ? "Refresh contributions": "Find saved work",
                        OnClick = () -> saved.ToggleReading(),
                        Primary = true,
                    }).Build(),
                    (page.Button with{Label = "Open saved run", OnClick = () -> saved.ToggleImport()}).Build(),
                },
            }.Build(),
        }
        let notice = feedback.Current
        if notice.Message != "" {
            body.Insert(1, Callout{Message: notice.Message, Tone: notice.Tone}.Build())
        }
        if notice.Report != "" {
            body.Add(ReportText{Content: notice.Report}.Build())
        }
        if state.Importing && !state.Selected {
            body.Add(
                RunOpener{
                    Path: state.RunPath,
                    Button: page.Button,
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    OnPath: value -> saved.SetRunPath(value),
                    OnOpen: () -> saved.LoadRun(),
                }.Build()
            )
        }
        if state.Selected {
            body.AddRange(details.Build(page))
        } else if state.Loaded {
            body.AddRange(list.Build(page))
        }
        return Stack{Gap: 20, Children: body.ToArray()}.Build()
    }
}
