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
            Gap: AppTheme.SectionGap,
            Children: []Blob{
                PresetGroup{Button: page.Button, Labels: SetupSteps.Names, Selected: step, OnChoose: show}.Build(),
                Swap{Key: step.ToString(), Gap: AppTheme.SectionGap, Children: body.ToArray()}.Build(),
            },
        }.Build()
    }

    private func Checks(page PageContext, editor SetupEditorInput) Blob -> Panel{
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
            IconHeading{Icon: "tune", Content: "Models", Detail: "Choose the models donors may use."}.Build(),
            Dropdown{
                Caption: "Tool",
                Value: setup.ModelTool,
                Options: tools.ToArray(),
                OnChange: tool -> owner.SetModelTool(tool),
                Disabled: page.Busy,
                Width: AppTheme.FieldWidth,
                Popup: page.Popup,
            }.Build(),
            Label{Content: setup.ModelTool.StartsWith("command/") ? "Select models for this command harness.": "Allow all models or select a list.", Size: AppTheme.SmallSize}.Build(),
        }
        if !setup.ModelTool.StartsWith("command/") {
            models.Add(ModelPolicyPicker{
                Policy: modelPolicy, Disabled: page.Busy, OnChoose: value -> owner.SetModelPolicy(value),
            }.Build())
        }
        if modelPolicy != "unrestricted" {
            models.Add(ModelWhitelistEditor.Mount(editor))
        }
        return Stack{
            Gap: AppTheme.SectionGap,
            Children: []Blob{
                EligibilityPicker{
                    Selected: setup.EffectiveEligibility(policy),
                    Disabled: page.Busy,
                    Stacked: page.Metrics.ContentWidth < AppTheme.ColumnsBreakpoint,
                    OnChoose: mode -> owner.SetEligibility(mode),
                }.Build(),
                HarnessEditor.Mount(
                    HarnessEditorInput{
                        Owner: owner,
                        Logo: id -> art.Logo(id).Render(),
                        Busy: page.Busy,
                        Button: page.Button,
                    }
                ),
                Panel{Children: models.ToArray()}.Build(),
                LimitsEditor{
                    Minutes: setup.Minutes,
                    Placeholder: (policy.MaxSeconds / 60).ToString(),
                    Disabled: page.Busy,
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
            if option.Id == "command" {
                continue
            }
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
        for pair in pairs {
            if pair.StartsWith("command/") {
                harnesses.Add(pair)
            }
        }
        let minutes = setup.Minutes != "" ? setup.Minutes: (policy.MaxSeconds / 60).ToString()
        let models = List[string]()
        for pair in pairs {
            let tool = Array.Find(setup.ToolModels, item -> item.Tool == pair)
            models.Add(pair + ": " + (tool.Restricted ? Count(tool.Models.Length, "selected model"): "All supported"))
        }
        let review = SetupReview{
            Repository: owner.Repository,
            CommandCount: state.Setup.Commands.Length,
            CheckCount: state.Setup.Checks.Length,
            Contributors: Eligibility.Label(setup.EffectiveEligibility(policy)),
            Harnesses: String.Join(", ", harnesses),
            Models: String.Join(", ", models),
            Limit: minutes == "0" ? "": Count(int32.TryParse(minutes, out var limit) ? limit: 0, "minute") + " for each donation",
            Written: state.PolicyTruncated ? "The CLI omitted policy entries. Use tokate init to preserve the complete tool permissions.": state.Written,
            Report: state.SetupReport,
            Previewed: state.SetupPreviewed,
            Disabled: page.Busy,
            Button: page.Button,
            OnApply: () -> owner.Apply(),
            OnPreview: () -> owner.PreviewSetup(),
        }.Build()
        let health = List[Blob]{
            IconHeading{
                Icon: "fact_check", Content: "Repository health",
                Detail: "Check policy, access and GitHub Actions.",
            }.Build(),
            Row{Children: []Blob{(page.Button with{Label = "Check repository health", OnClick = () -> owner.CheckPrerequisites(), Primary = true}).Build()}}.Build(),
        }
        if state.DoctorReport != "" {
            health.Add(ReportText{Content: state.DoctorReport, MaxHeight: AppTheme.ReportMaxHeight}.Build())
        }
        return Stack{
            Gap: AppTheme.SectionGap,
            Children: []Blob{
                review,
                Panel{Children: health.ToArray()}.Build(),
            },
        }.Build()
    }
}
