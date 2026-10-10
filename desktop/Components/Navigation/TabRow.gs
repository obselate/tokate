package TokateDesktop

import Goo
import System

/// Section tabs drawn as command buttons; the selected tab is primary. Each tab is derived from `Button`.
data struct TabRow {
    var Button CommandButton
    var Tabs []string
    var Selected string
    var OnSelect Action[string]?

    func Build() Container {
        let choose = OnSelect
        let selected = Array.IndexOf(Tabs, Selected)
        return PresetGroup{
            Button: Button,
            Labels: Tabs,
            Selected: selected,
            OnChoose: index -> choose?.Invoke(Tabs[index]),
        }.Build()
    }
}
