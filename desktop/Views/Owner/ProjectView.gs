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

    init(owner OwnerService, art ArtworkService) {
        this.owner = owner
        contributions = ContributionsTab(owner)
        access = AccessTab(owner)
        setup = SetupTab(owner, art)
    }

    /// Identifies the project list, the open project and each issue, so each starts at the top.
    prop Key string -> "My project" + (owner.Current.Open ? owner.Repository + "#" + (owner.Current.Selected?.NumberText ?? ""): "")

    prop IsBrowsing bool -> owner.Current.Browsing

    func Build(page PageContext) Blob {
        let state = owner.Current
        let issue = state.Open && state.Tab == OwnerTab.Contributions && state.Selected != nil
        let body = List[Blob]()
        if issue {
            body.AddRange(contributions.Build(page))
        } else if state.Open {
            body.Add(
                Row{
                    Children: []Blob{
                        Heading{Content: owner.Repository, Size: AppTheme.DisplaySize}.Build(),
                        Spacer{}.Build(),
                        Row{
                            NoWrap: true,
                            Children: []Blob{
                                (page.Button with{Label = "Change project", Icon = "arrow_back", IconFirst = true, OnClick = () -> owner.Close()}).Build(),
                                (page.Button with{
                                    Label = "Refresh project",
                                    Kind = ButtonKind.Icon,
                                    Icon = "refresh",
                                    OnClick = () -> {
                                        if state.Tab == OwnerTab.Access {
                                            owner.LoadAccess()
                                        } else {
                                            owner.Refresh()
                                        }
                                    },
                                }).Build(),
                            },
                        }.Build(),
                    },
                }.Build()
            )
        } else {
            body.Add(
                Row{
                    Children: []Blob{
                        Heading{Content: "My project", Size: AppTheme.DisplaySize}.Build(),
                        Spacer{}.Build(),
                        Row{
                            NoWrap: true,
                            Children: []Blob{
                                (page.Button with{
                                    Label = "Check owner prerequisites",
                                    Primary = false,
                                    OnClick = () -> owner.CheckPrerequisites(),
                                }).Build(),
                                (page.Button with{
                                    Label = "Refresh projects",
                                    Kind = ButtonKind.Icon,
                                    Icon = "refresh",
                                    OnClick = () -> owner.LoadProjects(),
                                }).Build(),
                            },
                        }.Build(),
                    },
                }.Build()
            )
        }
        if issue {
            let header = body[0]
            body.RemoveAt(0)
            return page.Layout(header, body.ToArray())
        }
        if !state.Open {
            if state.DoctorReport != "" {
                body.Add(Panel{Children: []Blob{
                    IconHeading{Icon: "fact_check", Content: "Owner prerequisites"}.Build(),
                    OwnerHealthReport{Report: state.DoctorReport}.Build(),
                }}.Build())
            }
            body.Add(
                ProjectOpener{
                    Input: state.Input,
                    Projects: state.Projects,
                    Loaded: state.ProjectsLoaded,
                    Button: page.Button,
                    Disabled: page.Busy,
                    Loader: page.Loader,
                    OnInput: value -> owner.SetInput(value),
                    OnOpen: () -> owner.Open(),
                    OnChoose: repository -> owner.OpenRepository(repository),
                }.Build()
            )
            let header = body[0]
            body.RemoveAt(0)
            return page.Layout(header, body.ToArray())
        }
        let tabs = List[string]()
        for tab in OwnerTabs.All {
            tabs.Add(OwnerTabs.Label(tab))
        }
        body.Add(
            TabRow.Mount(
                "project-tabs",
                TabRowInput{
                    Button: page.Button,
                    Tabs: tabs.ToArray(),
                    Selected: Array.IndexOf(OwnerTabs.All, state.Tab),
                    Counts: []int32{0, state.Access.Pending.Length},
                    OnSelect: index -> owner.SelectTab(OwnerTabs.All[index]),
                }
            )
        )
        if state.Tab == OwnerTab.Setup {
            body.Add(PresetGroup{
                Button: page.Button, Labels: SetupSteps.Names, Selected: state.Setup.Step,
                OnChoose: step -> {
                    owner.SetStep(step)
                    page.OnTop?.Invoke()
                },
            }.Build())
        }
        let header = Stack{Gap: AppTheme.SectionGap, Children: body.ToArray()}.Build()
        body.Clear()
        let messages = List[Blob]()
        if state.Tab == OwnerTab.Setup {
            messages.Add(setup.Build(page))
        } else if state.Tab == OwnerTab.Access {
            messages.Add(access.Build(page))
        } else {
            messages.AddRange(contributions.Build(page))
        }
        body.Add(
            Swap{
                Key: OwnerTabs.Label(state.Tab),
                Gap: AppTheme.Space16,
                Fill: state.Browsing && !page.Metrics.Short,
                Children: messages.ToArray(),
            }.Build()
        )
        return page.Layout(header, body.ToArray(), fill: state.Browsing && !page.Metrics.Short, notices: state.Tab == OwnerTab.Access && !state.Project.CanWrite ?
            []Blob{Callout{Message: "Write access is required to manage donors", Tone: Tone.Wait}.Build()}: []Blob{})
    }
}
