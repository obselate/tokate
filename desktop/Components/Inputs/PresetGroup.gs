package TokateDesktop

import Goo
import System

/// A row of command buttons where the selected option is primary. Each option is derived from `Button`.
data struct PresetGroup {
    var Button CommandButton
    var Labels []string
    var Selected int32
    var Unavailable []bool
    var OnChoose Action[int32]?

    func Build() Container {
        let row = Row{}.Build()
        let choose = OnChoose
        for i in 0 ... Labels.Length {
            let index = i
            let unavailable = i < Unavailable.Length && Unavailable[i]
            row.Children.Add(
                (Button with{
                    Label = Labels[i],
                    OnClick = () -> choose?.Invoke(index),
                    Primary = i == Selected,
                    Disabled = unavailable,
                }).Build()
            )
        }
        return row
    }
}
