package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved work page: the list of saved runs below its actions, or the selected run.
class SavedView {
    private let saved SavedWorkService
    private let list SavedListView
    private let details SavedRunView

    init(saved SavedWorkService) {
        this.saved = saved
        list = SavedListView(saved)
        details = SavedRunView(saved)
    }

    prop IsBrowsing bool -> saved.Current.Browsing

    func Build(page PageContext) Blob {
        let state = saved.Current
        let notice = page.Feedback
        let body = List[Blob]()
        if state.Selected {
            body.AddRange(details.Build(page, notice))
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
        if state.Importing && !state.Selected {
            body.Add(
                RunOpener{
                    Path: state.RunPath,
                    Button: page.Button,
                    Disabled: page.Busy,
                    OnPath: value -> saved.SetRunPath(value),
                    OnOpen: () -> saved.LoadRun(),
                }.Build()
            )
        }
        if state.Loaded && !state.Selected {
            body.AddRange(list.Build(page))
        }
        let header = body[0]
        body.RemoveAt(0)
        let notices = List[Blob]()
        if state.Selected {
            let run = state.Run
            if run.ErrorMessage != "" {
                notices.Add(Callout{Message: run.FailureReason + ": " + run.ErrorMessage + "\n" + CliError{Code: run.FailureReason}.Recovery, Tone: Tone.Fail}.Build())
            }
            for message in []string{run.Warning, run.Guidance} {
                if message != "" {
                    notices.Add(Callout{Message: message, Tone: Tone.Need}.Build())
                }
            }
            if state.Note.Message != "" && state.Note.Message != notice.Message {
                notices.Add(Callout{Message: state.Note.Message, Tone: state.Note.Tone}.Build())
            }
        }
        return page.Layout(header, body.ToArray(), notices: notices.ToArray())
    }
}
