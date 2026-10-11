package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved work page: the list of saved runs below its actions, or the selected run.
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
        let body = List[Blob]()
        if state.Selected {
            body.AddRange(details.Build(page))
        } else {
            body.Add(
                Row{
                    Children: []Blob{
                        Heading{Content: "Saved work", Size: AppTheme.DisplaySize}.Build(),
                        Spacer{}.Build(),
                        (page.Button with{Label = "Open run directory", OnClick = () -> saved.ToggleImport()}).Build(),
                        (page.Button with{
                            Label = state.Reading ? "Stop updating": state.Loaded ? "Refresh contributions": "Find saved work",
                            Kind = ButtonKind.Icon,
                            Icon = state.Reading ? "close": "refresh",
                            OnClick = () -> saved.ToggleReading(),
                        }).Build(),
                    },
                }.Build()
            )
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
        if state.Loaded && !state.Selected {
            body.AddRange(list.Build(page))
        }
        return Stack{Gap: 16, Children: body.ToArray()}.Build()
    }
}
