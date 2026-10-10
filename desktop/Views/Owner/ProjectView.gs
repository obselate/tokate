package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The owner's page: open a project, then work in its Contributions, Access and Setup tabs.
class ProjectView {
    private let owner OwnerService
    private let contributions ContributionsTab
    private let access AccessTab
    private let setup SetupTab

    init(owner OwnerService) {
        this.owner = owner
        contributions = ContributionsTab(owner)
        access = AccessTab(owner)
        setup = SetupTab(owner)
    }

    /// Identifies the visible tab and setup step so each starts at the top.
    prop Key string -> "My project" + OwnerTabs.Label(owner.Current.Tab) + owner.Current.Setup.Step.ToString()

    prop IsBrowsing bool -> owner.Current.Browsing

    func Build(page PageContext) Blob {
        let state = owner.Current
        let body = List[Blob]{Heading{Content: "My project", Size: 38}.Build()}
        if !state.Open {
            body.Add(
                ProjectOpener{
                    Input: state.Input,
                    Button: page.Button,
                    Disabled: page.Busy,
                    OnInput: value -> owner.SetInput(value),
                    OnOpen: () -> owner.Open(),
                    OnCheck: () -> owner.CheckPrerequisites(),
                }.Build()
            )
            return Stack{Gap: 20, Children: body.ToArray()}.Build()
        }
        body.Add(
            Row{
                Children: []Blob{
                    Heading{Content: owner.Repository, Size: 28}.Build(),
                    (page.Button with{Label = "Change project", OnClick = () -> owner.Close()}).Build(),
                    (page.Button with{Label = "Refresh project", OnClick = () -> owner.Refresh()}).Build(),
                },
            }.Build()
        )
        let tabs = List[Blob]()
        for tab in OwnerTabs.All {
            let selected = tab
            tabs.Add(
                (page.Button with{
                    Label = OwnerTabs.Label(tab),
                    OnClick = () -> owner.SelectTab(selected),
                    Primary = state.Tab == tab,
                }).Build()
            )
        }
        body.Add(Row{Children: tabs.ToArray()}.Build())
        if state.Tab == OwnerTab.Setup {
            body.Add(setup.Build(page))
        } else if state.Tab == OwnerTab.Access {
            body.Add(access.Build(page))
        } else {
            body.AddRange(contributions.Build(page))
        }
        return Stack{Gap: 20, Children: body.ToArray()}.Build()
    }
}
