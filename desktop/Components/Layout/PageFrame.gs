package TokateDesktop

import Goo

/// The centered content column of a page. Filled frames take the full height; wide frames drop the width cap.
/// `Stretch` lets the first child fill the remaining height, for pages that scroll inside a list.
data struct PageFrame {
    var Key string
    var Handle ElementHandle?
    var Fill bool
    var Wide bool
    var Stretch bool
    var Children []Blob

    func Build() Container {
        let frame = Container{
            Key: Key,
            Width: Percent(100),
            Height: Fill ? Percent(100): Length.Auto,
            FlexShrink: Fill ? 1: 0,
            MinHeight: 0,
            MaxWidth: Wide ? Percent(100): Length(1050),
            AlignSelf: AlignSelf.Center,
            Gap: 18,
            Children: Children ?? []Blob{},
        }
        if Stretch && frame.Children.Count > 0 {
            let page = frame.Children[0]
            page.FlexGrow = 1
            page.FlexShrink = 1
            page.FlexBasis = 0
            page.MinHeight = 0
        }
        if let handle = Handle {
            frame.Handle = handle
        }
        return frame
    }
}
