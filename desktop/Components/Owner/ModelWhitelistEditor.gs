package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The models donors may use and their reasoning efforts. Holds the model and efforts being typed.
open class ModelWhitelistEditor : Cell[SetupEditorInput] {
    private var model string = ""
    private var efforts string = ""

    protected override func Build(input SetupEditorInput) Blob {
        let owner = input.Owner
        let rows = List[Blob]()
        for allowance in input.Setup.Models {
            let key = allowance.Model
            rows.Add(
                Row{
                    Children: []Blob{
                        Label{Content: key + " / " + String.Join(", ", allowance.Efforts), Size: 20}.Build(),
                        (input.Button with{Label = "Remove " + key, OnClick = () -> owner.RemoveModel(key)}).Build(),
                    },
                }.Build()
            )
        }
        rows.Add(
            Row{
                Children: []Blob{
                    InputField{
                        Label: "Model ID",
                        Value: model,
                        OnChange: value -> {
                            model = value
                        },
                        Placeholder: "gpt-6.1-sol",
                        Width: 300,
                        Disabled: input.Busy,
                    }.Build(),
                    InputField{
                        Label: "Efforts",
                        Value: efforts,
                        OnChange: value -> {
                            efforts = value
                        },
                        Placeholder: "high,xhigh",
                        Width: 200,
                        Disabled: input.Busy,
                    }.Build(),
                    (input.Button with{
                        Label = "Add model",
                        OnClick = () -> {
                            owner.AddModel(model, efforts)
                            model = ""
                            efforts = ""
                        },
                        Disabled = String.IsNullOrWhiteSpace(model),
                    }).Build(),
                },
            }.Build()
        )
        return Stack{Gap: 18, Children: rows.ToArray()}.Build()
    }

    shared {
        func Mount(input SetupEditorInput) Blob -> Container{
            Children: []Blob{Cell.Mount[SetupEditorInput, ModelWhitelistEditor]("model-whitelist", input)},
        }
    }
}
