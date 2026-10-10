package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Project setup in three steps: checks, permissions, then review and apply.
class SetupTab {
    private let owner OwnerService

    init(owner OwnerService) {
        this.owner = owner
    }

    func Build(page PageContext) Blob {
        let setup = owner.Current.Setup
        let step = setup.Step
        let steps = List[Blob]()
        for index in 0 ... SetupSteps.Names.Length {
            let target = index
            steps.Add(
                (page.Button with{
                    Label = SetupSteps.Names[index],
                    OnClick = () -> owner.SetStep(target),
                    Primary = step == index,
                }).Build()
            )
        }
        let body = List[Blob]{Row{Children: steps.ToArray()}.Build()}
        let editor = SetupEditorInput{Owner: owner, Setup: setup, Busy: page.Busy, Button: page.Button}
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
                        (page.Button with{Label = "Back", OnClick = () -> owner.SetStep(step - 1), Disabled = step == 0}).Build(),
                        (page.Button with{
                            Label = SetupSteps.Next(step),
                            OnClick = () -> owner.SetStep(step + 1),
                            Primary = true,
                        }).Build(),
                    },
                }.Build()
            )
        }
        return Stack{Gap: 18, Children: body.ToArray()}.Build()
    }

    private func Checks(page PageContext, editor SetupEditorInput) Blob -> Panel{
        Compact: page.CompactPanels,
        Children: []Blob{VerificationEditor.Mount(editor), Rule{}.Build(), RequiredChecksEditor.Mount(editor)},
    }.Build()

    private func Permissions(page PageContext, editor SetupEditorInput) Blob {
        let state = owner.Current
        let setup = state.Setup
        let policy = state.Policy
        let modelPolicy = setup.EffectiveModelPolicy(policy)
        let models = List[Blob]{
            Heading{Content: "Models", Size: 28}.Build(),
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
                    OnChoose: mode -> owner.SetEligibility(mode),
                }.Build(),
                ToolsPicker{
                    Allowed: setup.EffectiveTools(policy),
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    OnToggle: id -> owner.ToggleTool(id),
                }.Build(),
                Panel{Compact: page.CompactPanels, Children: models.ToArray()}.Build(),
                LimitsEditor{
                    Minutes: setup.Minutes,
                    Placeholder: (policy.MaxSeconds / 60).ToString(),
                    Network: setup.EffectiveNetwork(policy),
                    Disabled: page.Busy,
                    Compact: page.CompactPanels,
                    OnMinutes: value -> owner.SetMinutes(value),
                    OnNetwork: value -> owner.SetNetwork(value),
                }.Build(),
            },
        }.Build()
    }

    private func Review(page PageContext) Blob {
        let state = owner.Current
        return SetupReview{
            Path: state.Setup.Path,
            Repository: owner.Repository,
            CommandCount: state.Setup.Commands.Length,
            CheckCount: state.Setup.Checks.Length,
            Preview: state.Preview,
            Disabled: page.Busy,
            Compact: page.CompactPanels,
            Button: page.Button,
            OnPath: value -> owner.SetPath(value),
            OnPreview: () -> owner.Preview(),
            OnApply: () -> owner.Apply(),
        }.Build()
    }
}
