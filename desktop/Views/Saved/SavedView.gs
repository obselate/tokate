package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The saved work page: the list of saved runs, or the selected run.
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
        let body = List[Blob]{
            Heading{Content: "Saved work", Size: 38}.Build(),
            Row{
                Children: []Blob{
                    (page.Button with{
                        Label = state.Reading ? "Stop updating": state.Loaded ? "Refresh contributions": "Find saved work",
                        OnClick = () -> saved.ToggleReading(),
                        Primary = true,
                    }).Build(),
                    (page.Button with{Label = "Open saved run", OnClick = () -> saved.ToggleImport()}).Build(),
                },
            }.Build(),
        }
        if state.Importing {
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
