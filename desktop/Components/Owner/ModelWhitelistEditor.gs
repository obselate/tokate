package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic

/// The models donors may use and their reasoning efforts. A model comes from the catalog of an allowed
/// harness, or from a typed model ID. Holds the model and efforts being chosen.
open class ModelWhitelistEditor : Cell[SetupEditorInput] {
    private var source string = ""
    private var mode string = ""
    private var model string = ""
    private var efforts List[string] = List[string]()

    protected override func Build(input SetupEditorInput) Blob {
        let owner = input.Owner
        let state = owner.Current
        let sources = Sources(state)
        let current = Array.Exists(sources, option -> option.Id == source) ? source: sources[0].Id ?? "other"
        if current != mode {
            mode = current
            Clear()
        }
        let catalog = Catalog(state, current)
        let rows = List[Blob]()
        let allowed = List[Blob]{Rule{}.Build()}
        for allowance in input.Setup.Models {
            let key = allowance.Model
            let levels = List[string]()
            for effort in allowance.Efforts {
                levels.Add(ModelChoice.EffortLabel(effort))
            }
            allowed.Add(
                Row{
                    Gap: AppTheme.Space16,
                    Children: []Blob{
                        Container{FlexGrow: 1, FlexBasis: 0, MinWidth: AppTheme.ShortFieldWidth, Label{Content: key, Mono: true}.Build()},
                        Label{Content: String.Join(", ", levels), Size: AppTheme.SmallSize, Muted: true}.Build(),
                        (input.Button with{
                            Label = "Remove",
                            Name = "Remove " + key,
                            Tone = ButtonTone.Danger,
                            OnClick = () -> owner.RemoveModel(key),
                        }).Build(),
                    },
                }.Build()
            )
            allowed.Add(Rule{}.Build())
        }
        if allowed.Count > 1 {
            rows.Add(Stack{Gap: AppTheme.Space8, Children: allowed.ToArray()}.Build())
        }
        let fields = List[Blob]()
        if sources.Length > 1 {
            fields.Add(
                Dropdown{
                    Caption: "Source",
                    Value: current,
                    Options: sources,
                    OnChange: value -> {
                        source = value
                    },
                    Width: AppTheme.ShortFieldWidth,
                    Disabled: input.Busy,
                    Popup: input.Popup,
                }.Build()
            )
        }
        var options = DonationDraft.Efforts
        if current == "other" {
            fields.Add(
                InputField{
                    Label: "Model ID",
                    Value: model,
                    OnChange: value -> {
                        model = value
                    },
                    Placeholder: "Exact model ID",
                    Width: AppTheme.FieldWidth,
                    Disabled: input.Busy,
                }.Build()
            )
        } else {
            let models = List[ComboBoxOption]()
            options = []string{}
            for choice in catalog {
                models.Add(Option(choice.Slug, choice.DisplayName))
                if choice.Slug == model {
                    options = choice.Efforts
                }
            }
            fields.Add(
                Dropdown{
                    Caption: "Model",
                    Value: model,
                    Placeholder: "Choose a model",
                    Options: models.ToArray(),
                    OnChange: value -> {
                        model = value
                        efforts = List[string](Array.Find(catalog, choice -> choice.Slug == value).Efforts)
                    },
                    Width: AppTheme.FieldWidth,
                    Searchable: models.Count > 12,
                    Disabled: input.Busy,
                    Popup: input.Popup,
                }.Build()
            )
        }
        rows.Add(Row{Align: AlignItems.FlexEnd, Children: fields.ToArray()}.Build())
        if options.Length > 0 {
            let checks = List[Blob]()
            for effort in options {
                let level = effort
                checks.Add(
                    Check{
                        Label: ModelChoice.EffortLabel(level),
                        Value: efforts.Contains(level),
                        OnChange: value -> {
                            if value && !efforts.Contains(level) {
                                efforts.Add(level)
                            } else if !value {
                                efforts.Remove(level)
                            }
                        },
                        Disabled: input.Busy,
                    }.Build()
                )
            }
            rows.Add(
                Stack{
                    Gap: AppTheme.Space8,
                    Children: []Blob{
                        Label{Content: "Reasoning efforts", Size: AppTheme.SmallSize, Muted: true}.Build(),
                        Row{Gap: AppTheme.Space24, Children: checks.ToArray()}.Build(),
                    },
                }.Build()
            )
        }
        let chosen = List[string]()
        for effort in options {
            if efforts.Contains(effort) {
                chosen.Add(effort)
            }
        }
        rows.Add(
            Row{
                Children: []Blob{
                    (input.Button with{
                        Label = "Add model",
                        OnClick = () -> {
                            owner.AddModel(model, String.Join(",", chosen))
                            Clear()
                        },
                        Disabled = String.IsNullOrWhiteSpace(model) || chosen.Count == 0,
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: AppTheme.Space16, Children: rows.ToArray()}.Build()
    }

    private func Clear() {
        model = ""
        efforts = mode == "other" ? List[string]{"absent"}: List[string]()
    }

    /// The catalogs of the allowed harnesses that have models, then the typed model ID.
    private func Sources(state OwnerState) []ComboBoxOption {
        let result = List[ComboBoxOption]()
        let pairs = []string{state.Setup.ModelTool}
        for id in []string{"codex", "claude"} {
            if Array.IndexOf(pairs, id + "/" + HarnessOption.ProviderOf(id)) >= 0 && Catalog(state, id).Length > 0 {
                result.Add(Option(id, HarnessOption.NameOf(id)))
            }
        }
        for pair in pairs {
            if pair.StartsWith("omp/") && Catalog(state, pair).Length > 0 {
                result.Add(Option(pair, "OMP \u00b7 " + pair.Substring(4)))
            }
        }
        result.Add(Option("other", "Other model ID"))
        return result.ToArray()
    }

    private func Catalog(state OwnerState, id string) []ModelChoice -> id == "codex" ? state.Codex: id == "claude" ? ModelChoice.Claude: id.StartsWith(
        "omp/"
    ) ? Array.FindAll(state.Omp, choice -> choice.Provider == id.Substring(4)): []ModelChoice{}

    private func Option(id string, name string) ComboBoxOption -> ComboBoxOption{
        Id: id,
        Label: name,
        Content: Label{Content: name}.Build(),
    }

    shared {
        func Mount(input SetupEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[SetupEditorInput, ModelWhitelistEditor]("model-whitelist", input)},
        }
    }
}
