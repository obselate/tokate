package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The coding tool a donation uses.
data struct HarnessPicker {
    var Selected string
    var Disabled bool
    var OnChoose Action[string]?

    func Build() Blob {
        let choose = OnChoose
        let cards = List[Blob]()
        for option in HarnessOption.All {
            let id = option.Id
            cards.Add(
                ChoiceCard{
                    Title: option.Name,
                    Detail: "",
                    Icon: HarnessIcons.For(id),
                    Selected: Selected == id,
                    OnChoose: () -> choose?.Invoke(id),
                    Disabled: Disabled,
                }.Build()
            )
        }
        return Row{Children: cards.ToArray()}.Build()
    }
}
