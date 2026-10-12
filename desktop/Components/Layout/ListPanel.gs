package TokateDesktop

import Goo

/// A panel for table rows. It is as high as its rows and scrolls when they do not fit in the remaining
/// height of the page, unless the window is short. `Fill` makes it take all the height, for a loader or a
/// placeholder.
data struct ListPanel {
    var Children []Blob
    var Short bool
    var Fill bool

    func Build() Container {
        let panel = Panel{Children: Children}.Build()
        panel.Padding = 8
        panel.Gap = 0
        panel.FlexGrow = Fill && !Short ? 1: 0
        panel.FlexShrink = Short ? 0: 1
        panel.MinHeight = 0
        panel.OverflowY = Short ? Overflow.Visible: Overflow.Scroll
        return Container{FlexGrow: Fill && !Short ? 1: 0, FlexShrink: Short ? 0: 1, MinHeight: 0, panel}
    }
}
