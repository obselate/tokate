package TokateDesktop

import Goo

/// A panel for table rows. It fills and scrolls the remaining height unless the window is short.
data struct ListPanel {
    var Children []Blob
    var Short bool

    func Build() Container {
        let panel = Panel{Children: Children}.Build()
        panel.Padding = 8
        panel.Gap = 0
        panel.FlexGrow = Short ? 0: 1
        panel.FlexShrink = Short ? 0: 1
        panel.FlexBasis = Short ? Length.Auto: Length(0)
        panel.MinHeight = 0
        panel.OverflowY = Short ? Overflow.Visible: Overflow.Scroll
        return panel
    }
}
