package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Who may claim approved issues. `Stacked` gives each choice its own line.
data struct EligibilityPicker {
    var Selected string
    var Disabled bool
    var Compact bool
    var Stacked bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        let cards = List[Blob]()
        for mode in Eligibility.All {
            let value = mode
            let card = ChoiceCard{
                Title: Eligibility.Label(mode),
                Detail: Eligibility.Detail(mode),
                Icon: mode == "open" ? "public": "verified_user",
                Selected: Selected == mode,
                OnChoose: () -> choose?.Invoke(value),
                Disabled: Disabled,
            }.Build()
            cards.Add(Stacked ? Container{FlexDirection: FlexDirection.Row, Width: Percent(100), card}: card)
        }
        return Panel{
            Compact: Compact,
            Children: []Blob{
                IconHeading{Icon: "group", Content: "Who can contribute", Detail: "The donors that can claim an approved issue."}.Build(),
                Row{Children: cards.ToArray()}.Build(),
            },
        }.Build()
    }
}

/// All supported models, or only the selected ones.
data struct ModelPolicyPicker {
    var Policy string
    var Disabled bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        return Row{
            Children: []Blob{
                ChoiceCard{
                    Title: "All supported",
                    Detail: "Each model that a harness accepts.",
                    Icon: "apps",
                    Selected: Policy == "unrestricted",
                    OnChoose: () -> choose?.Invoke("unrestricted"),
                    Disabled: Disabled,
                }.Build(),
                ChoiceCard{
                    Title: "Selected models",
                    Detail: "Only the models in your list.",
                    Icon: "checklist",
                    Selected: Policy != "unrestricted",
                    OnChoose: () -> choose?.Invoke("whitelist"),
                    Disabled: Disabled,
                }.Build(),
            },
        }.Build()
    }
}

/// The donation time limit.
data struct LimitsEditor {
    var Minutes string
    var Placeholder string
    var Disabled bool
    var Compact bool
    var OnMinutes Action[string]?

    func Build() Blob -> Panel{
        Compact: Compact,
        Children: []Blob{
            IconHeading{Icon: "schedule", Content: "Time limit", Detail: "The longest time that one donation can use."}.Build(),
            InputField{
                Label: "Maximum minutes per donation",
                Value: Minutes,
                OnChange: OnMinutes,
                Placeholder: Placeholder,
                Width: 280,
                Disabled: Disabled,
            }.Build(),
        },
    }.Build()
}
