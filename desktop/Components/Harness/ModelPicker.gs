package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System
import System.Collections.Generic

/// The provider, model and reasoning effort. `Models` are the choices. Pi takes an exact model ID when
/// there are none, and a local endpoint. OMP offers `Providers`, or takes a provider name when there are none.
data struct ModelPicker {
    var Harness string
    var Provider string
    var Providers []string
    var Model string
    var Effort string
    var Endpoint string
    var Models []ModelChoice
    var Efforts []string
    var Disabled bool
    var OnModel Action[string]?
    var OnEffort Action[string]?
    var OnEndpoint Action[string]?
    var OnProvider Action[string]?
    var Popup PopupInput

    func Build() Blob {
        let fields = List[Blob]()
        if Harness == "omp" || Harness == "command" {
            let providers = List[ComboBoxOption]()
            for provider in Providers {
                providers.Add(Option(provider, provider))
            }
            fields.Add(
                providers.Count > 0 ? Choice("Provider", Provider, providers.ToArray(), OnProvider, AppTheme.ShortFieldWidth, "Choose"): Field(
                    "Provider",
                    Provider,
                    OnProvider,
                    "Provider name",
                    AppTheme.ShortFieldWidth
                )
            )
        }
        if (Harness == "pi" || Harness == "command") && Models.Length == 0 {
            fields.Add(Field("Model", Model, OnModel, "Exact model ID", AppTheme.ShortFieldWidth))
        } else {
            let models = List[ComboBoxOption]()
            for model in Models {
                models.Add(Option(model.Slug, model.DisplayName))
            }
            fields.Add(Choice("Model", Model, models.ToArray(), OnModel, AppTheme.ShortFieldWidth, "Choose a model"))
        }
        let efforts = List[ComboBoxOption]()
        for effort in Efforts {
            efforts.Add(Option(effort, ModelChoice.EffortLabel(effort)))
        }
        fields.Add(Choice("Reasoning effort", Effort, efforts.ToArray(), OnEffort, AppTheme.ShortFieldWidth, "Choose"))
        let children = List[Blob]{Row{Align: AlignItems.FlexEnd, Children: fields.ToArray()}.Build()}
        if Harness == "pi" {
            children.Add(Field("Local endpoint", Endpoint, OnEndpoint, "http://127.0.0.1:8080/v1", 0))
        }
        return Stack{Gap: AppTheme.Space16, Children: children.ToArray()}.Build()
    }

    /// A text field. Zero width fills the row.
    private func Field(caption string, value string, change Action[string]?, placeholder string, width float64) Blob ->
    InputField{
        Label: caption,
        Controlled: true,
        Value: value,
        OnChange: change,
        Placeholder: placeholder,
        Width: width,
        Fill: width == 0,
        Disabled: Disabled,
    }.Build()

    private func Option(id string, name string) ComboBoxOption -> ComboBoxOption{
        Id: id,
        Label: name,
        Content: Label{Content: name}.Build(),
    }

    private func Choice(
        caption string,
        value string,
        options []ComboBoxOption,
        change Action[string]?,
        width float64,
        placeholder string
    ) Blob -> Dropdown{
        Caption: caption,
        Value: value,
        Placeholder: placeholder,
        Options: options,
        OnChange: change,
        Width: width,
        Searchable: options.Length > 12,
        Disabled: Disabled,
        Popup: Popup,
    }.Build()
}
