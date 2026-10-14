package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic

/// Project setup in three steps: checks, permissions, then review and apply.
class SetupTab {
    private let owner OwnerService
    private let art ArtworkService

    init(owner OwnerService, art ArtworkService) {
        this.art = art
        this.owner = owner
    }

    func Build(page PageContext) Blob {
        let setup = owner.Current.Setup
        let step = setup.Step
        let top = page.OnTop
        let show = (index int32) -> {
            owner.SetStep(index)
            top?.Invoke()
        }
        let body = List[Blob]()
        let editor = SetupEditorInput{Owner: owner, Setup: setup, Busy: page.Busy, Button: page.Button, Popup: page.Popup}
        if step == 0 {
            body.Add(Checks(page, editor))
        } else if step == 1 {
            body.Add(Permissions(page, editor))
        } else {
            body.Add(Review(page))
        }
        if step < 2 {
            body.Add(
                Row{
                    Children: []Blob{
                        (page.Button with{Label = "Back", OnClick = () -> show(step - 1), Disabled = step == 0}).Build(),
                        (page.Button with{
                            Label = SetupSteps.Next(step),
                            OnClick = () -> show(step + 1),
                            Primary = true,
                        }).Build(),
                    },
                }.Build()
            )
        }
        return Stack{
            Gap: 18,
            Children: []Blob{
                PresetGroup{Button: page.Button, Labels: SetupSteps.Names, Selected: step, OnChoose: show}.Build(),
                Swap{Key: step.ToString(), Gap: 18, Children: body.ToArray()}.Build(),
            },
        }.Build()
    }

    private func Checks(page PageContext, editor SetupEditorInput) Blob -> Panel{
        Compact: page.CompactPanels,
        Children: []Blob{VerificationEditor.Mount(editor), Rule{}.Build(), RequiredChecksEditor.Mount(editor)},
    }.Build()

    private func Permissions(page PageContext, editor SetupEditorInput) Blob {
        let state = owner.Current
        let setup = state.Setup
        let policy = state.Policy
        let modelPolicy = setup.ModelPolicy
        let tools = List[ComboBoxOption]()
        for pair in setup.EffectiveTools() {
            tools.Add(ComboBoxOption{Id: pair, Label: pair, Content: Label{Content: pair}.Build()})
        }
        let models = List[Blob]{
            IconHeading{Icon: "tune", Content: "Models", Detail: "Model permissions apply to the selected tool."}.Build(),
            Dropdown{
                Caption: "Tool",
                Value: setup.ModelTool,
                Options: tools.ToArray(),
                OnChange: tool -> owner.SetModelTool(tool),
                Disabled: page.Busy,
                Popup: page.Popup,
            }.Build(),
            ModelPolicyPicker{
                Policy: modelPolicy,
                Disabled: page.Busy,
                OnChoose: value -> owner.SetModelPolicy(value),
            }.Build(),
        }
        if modelPolicy != "unrestricted" {
            models.Add(ModelWhitelistEditor.Mount(editor))
        }
        return Stack{
            Gap: 18,
            Children: []Blob{
                EligibilityPicker{
                    Selected: setup.EffectiveEligibility(policy),
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    Stacked: page.Metrics.ContentWidth < 790,
                    OnChoose: mode -> owner.SetEligibility(mode),
                }.Build(),
                HarnessEditor.Mount(
                    HarnessEditorInput{
                        Owner: owner,
                        Logo: id -> art.Logo(id).Render(),
                        Busy: page.Busy,
                        Compact: page.CompactPanels,
                        Button: page.Button,
                    }
                ),
                Panel{Compact: page.CompactPanels, Children: models.ToArray()}.Build(),
                LimitsEditor{
                    Minutes: setup.Minutes,
                    Placeholder: (policy.MaxSeconds / 60).ToString(),
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    OnMinutes: value -> owner.SetMinutes(value),
                }.Build(),
            },
        }.Build()
    }

    private func Count(number int32, noun string) string -> number.ToString() + " " + noun + (number == 1 ? "": "s")

    private func Review(page PageContext) Blob {
        let state = owner.Current
        let setup = state.Setup
        let policy = state.Policy
        let pairs = setup.EffectiveTools()
        let harnesses = List[string]()
        for option in HarnessOption.All {
            let providers = List[string]()
            for pair in pairs {
                if pair.StartsWith(option.Id + "/") {
                    providers.Add(pair.Substring(option.Id.Length + 1))
                }
            }
            if providers.Count > 0 {
                harnesses.Add(option.Id == "omp" ? option.Name + " (" + String.Join(", ", providers) + ")": option.Name)
            }
        }
        let minutes = setup.Minutes != "" ? setup.Minutes: (policy.MaxSeconds / 60).ToString()
        let models = List[string]()
        for pair in pairs {
            let tool = Array.Find(setup.ToolModels, item -> item.Tool == pair)
            models.Add(pair + ": " + (tool.Restricted ? Count(tool.Models.Length, "selected model"): "All supported"))
        }
        let review = SetupReview{
            Path: state.Setup.Path,
            Repository: owner.Repository,
            CommandCount: state.Setup.Commands.Length,
            CheckCount: state.Setup.Checks.Length,
            Contributors: Eligibility.Label(setup.EffectiveEligibility(policy)),
            Harnesses: String.Join(", ", harnesses),
            Models: String.Join(", ", models),
            Limit: minutes == "0" ? "": Count(int32.TryParse(minutes, out var limit) ? limit: 0, "minute") + " for each donation",
            Written: state.PolicyTruncated ? "The CLI omitted policy entries. Use tokate init to preserve the complete tool permissions.": state.Written,
            Disabled: page.Busy,
            Compact: page.CompactPanels,
            Button: page.Button,
            OnPath: value -> owner.SetPath(value),
            OnApply: () -> owner.Apply(),
        }.Build()
        let coordinator = state.Coordinator
        let workflow = List[Blob]{
            IconHeading{
                Icon: "sync",
                Content: "Coordinator workflow",
                Detail: "Preview the release pin before generating a new workflow. Applying also updates the Actions allowlist.",
            }.Build(),
            InputField{
                Label: "New workflow output file",
                Value: state.CoordinatorOutput,
                OnChange: value -> owner.SetCoordinatorOutput(value),
                Placeholder: "/path/to/project/tokate-coordinator.yml",
                Width: 650,
                Disabled: page.Busy,
            }.Build(),
            (page.Button with{Label = "Preview pin update", OnClick = () -> owner.PreviewCoordinator(), Disabled = state.CoordinatorOutput == ""}).Build(),
        }
        if coordinator.Loaded {
            workflow.Add(DetailRow{Caption: "Current version", Value: coordinator.CurrentVersion == "" ? "No coordinator installed": coordinator.CurrentVersion}.Build())
            if coordinator.CurrentCommit != "" {
                workflow.Add(DetailRow{Caption: "Current pin", Value: coordinator.CurrentCommit}.Build())
            }
            if coordinator.NewVersion != "" {
                workflow.Add(DetailRow{Caption: "New version", Value: coordinator.NewVersion}.Build())
            }
            if coordinator.NewCommit != "" {
                workflow.Add(DetailRow{Caption: "New pin", Value: coordinator.NewCommit}.Build())
            }
            let links = List[Blob]()
            if coordinator.CompareUrl != "" {
                links.Add((page.Button with{
                    Label = "Compare workflow pins", Kind = ButtonKind.Quiet, AllowWhileBusy = true,
                    OnClick = () -> Browser.Open(coordinator.CompareUrl),
                }).Build())
            }
            if coordinator.ReleaseUrl != "" {
                links.Add((page.Button with{
                    Label = "Read release notes", Kind = ButtonKind.Quiet, AllowWhileBusy = true,
                    OnClick = () -> Browser.Open(coordinator.ReleaseUrl),
                }).Build())
            }
            if links.Count > 0 {
                workflow.Add(Row{Children: links.ToArray()}.Build())
            }
            if coordinator.Applied {
                workflow.Add(Label{Content: coordinator.Allowlist, Size: AppTheme.SmallSize}.Build())
                workflow.Add(Label{
                    Content: "Review " + coordinator.Output + ", then install it as .github/workflows/tokate-coordinator.yml and commit it. " +
                        "Do not approve version 3 tasks until the coordinator supports them.",
                    Size: AppTheme.SmallSize,
                }.Build())
            } else {
                workflow.Add((page.Button with{Label = "Generate workflow", OnClick = () -> owner.ApplyCoordinator(), Primary = true}).Build())
            }
        }
        let health = List[Blob]{
            IconHeading{
                Icon: "fact_check", Content: "Repository health",
                Detail: "Check the coordinator pin, Actions settings, policy, access and pending requests without changing them.",
            }.Build(),
            (page.Button with{Label = "Check repository health", OnClick = () -> owner.CheckPrerequisites()}).Build(),
        }
        if state.DoctorReport != "" {
            health.Add(ReportText{Content: state.DoctorReport, MaxHeight: 420}.Build())
        }
        return Stack{
            Gap: 18,
            Children: []Blob{
                review,
                Panel{Compact: page.CompactPanels, Children: workflow.ToArray()}.Build(),
                Panel{Compact: page.CompactPanels, Children: health.ToArray()}.Build(),
            },
        }.Build()
    }
}
