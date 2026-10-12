package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct HarnessEditorInput {
    var Owner OwnerService
    var Logo Func[string, Blob]
    var Busy bool
    var Compact bool
    var Button CommandButton
}

/// Which harnesses donors may use, and which providers of OMP. Holds the provider name being typed.
open class HarnessEditor : Cell[HarnessEditorInput] {
    private var provider string = ""

    protected override func Build(input HarnessEditorInput) Blob {
        let owner = input.Owner
        let state = owner.Current
        let pairs = state.Setup.EffectiveTools(state.Policy)
        let allowed = List[string]()
        let kept = List[string]()
        for pair in pairs {
            if pair.StartsWith("omp/") {
                allowed.Add(pair.Substring(4))
            } else if !Known(pair) {
                kept.Add(pair)
            }
        }
        let cards = List[Blob]()
        for option in HarnessOption.All {
            let id = option.Id
            let selected = id == "omp" ? allowed.Count > 0: Array.IndexOf(pairs, id + "/" + option.Provider) >= 0
            cards.Add(
                ChoiceCard{
                    Title: option.Name,
                    Detail: id != "omp" || allowed.Count == 0 ? "": allowed.Count == 1 ? "1 provider": allowed.Count.ToString() + " providers",
                    Icon: "terminal",
                    Art: input.Logo(id),
                    Selected: selected,
                    OnChoose: () -> owner.ToggleTool(id),
                    Disabled: input.Busy,
                }.Build()
            )
        }
        let children = List[Blob]{Heading{Content: "Harnesses"}.Build(), Row{Children: cards.ToArray()}.Build()}
        if allowed.Count > 0 || state.OmpOpen {
            children.Add(Rule{}.Build())
            children.Add(Providers(input, state.OmpProviders(), allowed))
        }
        if kept.Count > 0 {
            children.Add(
                Label{
                    Content: "Also allowed: " + String.Join(", ", kept) + ". Setup keeps " + (kept.Count == 1 ? "this pair.": "these pairs."),
                    Size: AppTheme.SmallSize,
                    Muted: true,
                }.Build()
            )
        }
        return Panel{Compact: input.Compact, Children: children.ToArray()}.Build()
    }

    private func Known(pair string) bool {
        for option in HarnessOption.All {
            if pair == option.Id + "/" + option.Provider {
                return true
            }
        }
        return false
    }

    private func Providers(input HarnessEditorInput, offered []string, allowed List[string]) Blob {
        let owner = input.Owner
        let checks = List[Blob]()
        for name in offered {
            let current = name
            checks.Add(
                Container{
                    Width: 200,
                    AlignItems: AlignItems.FlexStart,
                    Check{
                        Label: name,
                        Value: allowed.Contains(name),
                        OnChange: value -> owner.ToggleProvider(current),
                        Disabled: input.Busy,
                    }.Build(),
                }
            )
        }
        let children = List[Blob]{
            Stack{
                Gap: 4,
                Children: []Blob{
                    Heading{Content: "OMP providers", Size: AppTheme.ItemSize}.Build(),
                    Label{
                        Content: "A donor can use OMP only with a provider that you allow.",
                        Size: AppTheme.SmallSize,
                        Muted: true,
                    }.Build(),
                },
            }.Build(),
        }
        if checks.Count > 0 {
            children.Add(Row{Gap: 10, Children: checks.ToArray()}.Build())
        }
        children.Add(
            Row{
                Align: AlignItems.FlexEnd,
                Children: []Blob{
                    InputField{
                        Label: "Other provider",
                        Value: provider,
                        OnChange: value -> {
                            provider = value
                        },
                        Placeholder: "Provider name",
                        Width: 260,
                        Disabled: input.Busy,
                    }.Build(),
                    (input.Button with{
                        Label = "Add provider",
                        OnClick = () -> {
                            if !allowed.Contains(provider.Trim()) {
                                owner.ToggleProvider(provider)
                            }
                            provider = ""
                        },
                        Disabled = String.IsNullOrWhiteSpace(provider),
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: 14, Children: children.ToArray()}.Build()
    }

    shared {
        func Mount(input HarnessEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[HarnessEditorInput, HarnessEditor]("harness-editor", input)},
        }
    }
}
