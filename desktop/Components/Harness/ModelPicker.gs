package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic

/// The model and reasoning effort. Codex offers its catalog; other tools take exact IDs and a local endpoint.
data struct ModelPicker {
    var Harness string
    var Model string
    var Effort string
    var Endpoint string
    var Models []CodexModel
    var Efforts []string
    var Disabled bool
    var OnModel Action[string]?
    var OnEffort Action[string]?
    var OnEndpoint Action[string]?
    var OnPopupKey Action[KeyEvent]?
    var OnPopupPointer Action[PointerEvent]?

    func Build() Blob {
        let children = List[Blob]()
        if Harness == "codex" {
            let models = List[ComboBoxOption]()
            for model in Models {
                models.Add(Option(model.Slug, model.DisplayName))
            }
            let efforts = List[ComboBoxOption]()
            for effort in Efforts {
                efforts.Add(Option(effort, CodexModel.EffortLabel(effort)))
            }
            children.Add(
                Row{
                    Children: []Blob{
                        Choice("Model", Model, models.ToArray(), OnModel, 230),
                        Choice("Reasoning effort", Effort, efforts.ToArray(), OnEffort, 170),
                    },
                }.Build()
            )
        } else {
            children.Add(
                Row{
                    Children: []Blob{
                        InputField{
                            Label: "Model",
                            Value: Model,
                            OnChange: OnModel,
                            Placeholder: "Exact model ID",
                            Width: 230,
                            Disabled: Disabled,
                        }.Build(),
                        InputField{
                            Label: "Reasoning effort",
                            Value: Effort,
                            OnChange: OnEffort,
                            Placeholder: "For example, high",
                            Width: 170,
                            Disabled: Disabled,
                        }.Build(),
                    },
                }.Build()
            )
        }
        if Harness == "pi" {
            children.Add(
                InputField{
                    Label: "Local endpoint",
                    Value: Endpoint,
                    OnChange: OnEndpoint,
                    Placeholder: "http://127.0.0.1:8080/v1",
                    Width: 540,
                    Disabled: Disabled,
                }.Build()
            )
        }
        return Stack{Gap: 18, Children: children.ToArray()}.Build()
    }

    private func Option(id string, name string) ComboBoxOption -> ComboBoxOption{
        Id: id,
        Label: name,
        Content: Label{Content: name}.Build(),
    }

    private func Choice(caption string, value string, options []ComboBoxOption, change Action[string]?, width float64) Blob ->
    Dropdown{
        Caption: caption,
        Value: value,
        Options: options,
        OnChange: change,
        Width: width,
        Disabled: Disabled,
        OnPopupKey: OnPopupKey,
        OnPopupPointer: OnPopupPointer,
    }.Build()
}
