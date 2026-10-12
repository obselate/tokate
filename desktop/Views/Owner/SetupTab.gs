package TokateDesktop

import Goo
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
        let modelPolicy = setup.EffectiveModelPolicy(policy)
        let models = List[Blob]{
            IconHeading{Icon: "tune", Content: "Models", Detail: "The models that a donor can use."}.Build(),
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
        let pairs = setup.EffectiveTools(policy)
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
        return SetupReview{
            Path: state.Setup.Path,
            Repository: owner.Repository,
            CommandCount: state.Setup.Commands.Length,
            CheckCount: state.Setup.Checks.Length,
            Contributors: Eligibility.Label(setup.EffectiveEligibility(policy)),
            Harnesses: String.Join(", ", harnesses),
            Models: setup.EffectiveModelPolicy(policy) == "unrestricted" ? "All supported": Count(setup.Models.Length, "selected model"),
            Limit: minutes == "0" ? "": Count(int32.TryParse(minutes, out var limit) ? limit: 0, "minute") + " for each donation",
            Written: state.Written,
            Disabled: page.Busy,
            Compact: page.CompactPanels,
            Button: page.Button,
            OnPath: value -> owner.SetPath(value),
            OnApply: () -> owner.Apply(),
        }.Build()
    }
}
