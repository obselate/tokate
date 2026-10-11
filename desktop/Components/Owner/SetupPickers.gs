package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Who may claim approved issues.
data struct EligibilityPicker {
    var Selected string
    var Disabled bool
    var Compact bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        let cards = List[Blob]()
        for mode in Eligibility.All {
            let value = mode
            cards.Add(
                ChoiceCard{
                    Title: Eligibility.Label(mode),
                    Detail: "",
                    Icon: mode == "open" ? "public": "verified_user",
                    Selected: Selected == mode,
                    OnChoose: () -> choose?.Invoke(value),
                    Disabled: Disabled,
                }.Build()
            )
        }
        return Panel{
            Compact: Compact,
            Children: []Blob{Heading{Content: "Who can contribute"}.Build(), Row{Children: cards.ToArray()}.Build()},
        }.Build()
    }
}

/// Which coding harnesses donors may use. At least one stays selected.
data struct ToolsPicker {
    var Allowed []string
    var Disabled bool
    var Compact bool
    var OnToggle Action[string]?

    func Build() Blob {
        let toggle = OnToggle
        let cards = List[Blob]()
        for option in HarnessOption.All {
            let id = option.Id
            cards.Add(
                ChoiceCard{
                    Title: option.Name,
                    Detail: "",
                    Icon: HarnessIcons.For(id),
                    Selected: Array.IndexOf(Allowed, id) >= 0,
                    OnChoose: () -> toggle?.Invoke(id),
                    Disabled: Disabled,
                }.Build()
            )
        }
        return Panel{
            Compact: Compact,
            Children: []Blob{Heading{Content: "Coding tools"}.Build(), Row{Children: cards.ToArray()}.Build()},
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
                    Detail: "",
                    Icon: "apps",
                    Selected: Policy == "unrestricted",
                    OnChoose: () -> choose?.Invoke("unrestricted"),
                    Disabled: Disabled,
                }.Build(),
                ChoiceCard{
                    Title: "Selected models",
                    Detail: "",
                    Icon: "checklist",
                    Selected: Policy != "unrestricted",
                    OnChoose: () -> choose?.Invoke("whitelist"),
                    Disabled: Disabled,
                }.Build(),
            },
        }.Build()
    }
}

/// The donation time limit and network access.
data struct LimitsEditor {
    var Minutes string
    var Placeholder string
    var Network bool
    var Disabled bool
    var Compact bool
    var OnMinutes Action[string]?
    var OnNetwork Action[bool]?

    func Build() Blob -> Panel{
        Compact: Compact,
        Children: []Blob{
            Heading{Content: "Limits"}.Build(),
            InputField{
                Label: "Maximum minutes per donation",
                Value: Minutes,
                OnChange: OnMinutes,
                Placeholder: Placeholder,
                Width: 280,
                Disabled: Disabled,
            }.Build(),
            Check{Label: "Allow project network access", Value: Network, OnChange: OnNetwork, Disabled: Disabled}.Build(),
        },
    }.Build()
}
