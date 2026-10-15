package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct HarnessEditorInput {
    var Owner OwnerService
    var Logo Func[string, Blob]
    var Busy bool
    var Button CommandButton
}

/// Which harnesses donors may use, and which providers of OMP. Holds the provider name being typed.
open class HarnessEditor : Cell[HarnessEditorInput] {
    private var provider string = ""
    private var commandProvider string = ""
    private var commandArgv string = ""
    private var commandOutput string = "session"

    protected override func Build(input HarnessEditorInput) Blob {
        let owner = input.Owner
        let state = owner.Current
        let pairs = state.Setup.EffectiveTools()
        let allowed = List[string]()
        let kept = List[string]()
        for pair in pairs {
            if pair.StartsWith("omp/") {
                allowed.Add(pair.Substring(4))
            } else if !pair.StartsWith("command/") && !Known(pair) {
                kept.Add(pair)
            }
        }
        let cards = List[Blob]()
        for option in HarnessOption.All {
            let id = option.Id
            if id == "command" {
                continue
            }
            let selected = id == "omp" ? allowed.Count > 0: Array.IndexOf(pairs, id + "/" + option.Provider) >= 0
            cards.Add(
                ChoiceCard{
                    Title: id == "pi" ? "Pi": option.Name,
                    Detail: id == "codex" ? "OpenAI": id == "claude" ? "Anthropic": id == "pi" ? "Local endpoint": allowed.Count == 0 ?
                    "Choose providers": allowed.Count == 1 ? "1 provider": allowed.Count.ToString() + " providers",
                    Icon: "terminal",
                    Art: input.Logo(id),
                    Selected: selected,
                    OnChoose: () -> owner.ToggleTool(id),
                    Disabled: input.Busy,
                }.Build()
            )
        }
        let children = List[Blob]{
            IconHeading{Icon: "terminal", Content: "Harnesses", Detail: "Choose the coding tools donors may use"}.Build(),
            Row{Children: cards.ToArray()}.Build(),
        }
        children.Add(Rule{}.Build())
        children.Add(Heading{Content: "Command harness", Size: AppTheme.ItemSize}.Build())
        children.Add(Label{
            Content: "Use a fixed executable and JSON arguments with {model}. Optional: {prompt_file}, {effort}, {checkout}. Runs without isolation.",
            Size: AppTheme.SmallSize, Muted: true,
        }.Build())
        for tool in state.Setup.ToolModels {
            if tool.Tool.StartsWith("command/") && Array.IndexOf(pairs, tool.Tool) >= 0 {
                let current = tool
                children.Add(Row{Children: []Blob{
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: AppTheme.ShortFieldWidth, Label{Content: tool.Tool + ": " + Json.StringArray(tool.Command) + " (" + tool.Output + ")", Mono: true}.Build()},
                    (input.Button with{Label = "Edit", Name = "Edit " + tool.Tool, OnClick = () -> {
                        commandProvider = current.Tool.Substring(8)
                        commandArgv = Json.StringArray(current.Command)
                        commandOutput = current.Output
                    }}).Build(),
                    (input.Button with{Label = "Remove", Tone = ButtonTone.Danger, Name = "Remove " + tool.Tool, OnClick = () -> owner.RemoveCommandTool(current.Tool)}).Build(),
                }}.Build())
            }
        }
        children.Add(InputField{
            Label: "Command provider", Value: commandProvider, OnChange: value -> {commandProvider = value},
            Placeholder: "my-tool", Width: AppTheme.ShortFieldWidth, Disabled: input.Busy,
        }.Build())
        children.Add(InputField{
            Label: "Command argv", Value: commandArgv, OnChange: value -> {commandArgv = value},
            Placeholder: "[\"my-tool\",\"--model\",\"{model}\",\"{prompt_file}\"]", Width: AppTheme.WideFieldWidth, Disabled: input.Busy,
        }.Build())
        children.Add(Label{Content: "Output format", Size: AppTheme.LabelSize, Muted: true}.Build())
        children.Add(PresetGroup{
            Button: input.Button, Labels: []string{"codex", "claude", "session"},
            Selected: commandOutput == "codex" ? 0: commandOutput == "claude" ? 1: 2,
            OnChoose: index -> {commandOutput = index == 0 ? "codex": index == 1 ? "claude": "session"},
        }.Build())
        children.Add(Row{Children: []Blob{(input.Button with{
            Label = "Save command harness", OnClick = () -> owner.AddCommandTool(commandProvider, commandArgv, commandOutput),
            Disabled = String.IsNullOrWhiteSpace(commandProvider) || String.IsNullOrWhiteSpace(commandArgv),
        }).Build()}}.Build())
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
        return Panel{Children: children.ToArray()}.Build()
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
                    Width: AppTheme.ShortFieldWidth,
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
                Gap: AppTheme.Space4,
                Children: []Blob{
                    Heading{Content: "OMP providers", Size: AppTheme.ItemSize}.Build(),
                    Label{
                        Content: "Only allowed providers can run OMP",
                        Size: AppTheme.SmallSize,
                        Muted: true,
                    }.Build(),
                },
            }.Build(),
        }
        if checks.Count > 0 {
            children.Add(Row{Gap: AppTheme.Space12, Children: checks.ToArray()}.Build())
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
                        Width: AppTheme.ShortFieldWidth,
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
        return Stack{Gap: AppTheme.Space16, Children: children.ToArray()}.Build()
    }

    shared {
        func Mount(input HarnessEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[HarnessEditorInput, HarnessEditor]("harness-editor", input)},
        }
    }
}
