package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The owner's page: open a project, then work in its Contributions, Access and Setup tabs.
class ProjectView {
    private let owner OwnerService
    private let feedback FeedbackService
    private let contributions ContributionsTab
    private let access AccessTab
    private let setup SetupTab

    init(owner OwnerService, feedback FeedbackService) {
        this.owner = owner
        this.feedback = feedback
        contributions = ContributionsTab(owner)
        access = AccessTab(owner)
        setup = SetupTab(owner)
    }

    /// Identifies the visible tab and setup step so each starts at the top.
    prop Key string -> "My project" + OwnerTabs.Label(owner.Current.Tab) + owner.Current.Setup.Step.ToString()

    prop IsBrowsing bool -> owner.Current.Browsing

    func Build(page PageContext) Blob {
        let state = owner.Current
        let body = List[Blob]{Heading{Content: "My project", Size: AppTheme.DisplaySize}.Build()}
        let notice = feedback.Current
        if notice.Message != "" {
            body.Add(Callout{Message: notice.Message, Tone: notice.Tone}.Build())
        }
        if notice.Report != "" {
            body.Add(ReportText{Content: notice.Report}.Build())
        }
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
                    Heading{Content: owner.Repository}.Build(),
                    (page.Button with{Label = "Change project", Kind = ButtonKind.Quiet, OnClick = () -> owner.Close()}).Build(),
                    (page.Button with{Label = "Refresh project", Kind = ButtonKind.Quiet, OnClick = () -> owner.Refresh()}).Build(),
                },
            }.Build()
        )
        let tabs = List[string]()
        for tab in OwnerTabs.All {
            tabs.Add(OwnerTabs.Label(tab))
        }
        body.Add(
            TabRow{
                Button: page.Button,
                Tabs: tabs.ToArray(),
                Selected: Array.IndexOf(OwnerTabs.All, state.Tab),
                Counts: []int32{0, state.Access.Pending.Length},
                OnSelect: index -> owner.SelectTab(OwnerTabs.All[index]),
            }.Build()
        )
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
