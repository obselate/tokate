package TokateDesktop

import Goo

/// The area beside the navigation rail: a background, the title bar, compact navigation and the scrolling
/// page. Pages that manage their own scrolling set `Scrolls` to false.
data struct Workspace {
    var Background Blob
    var Bar Blob
    var Navigation Blob?
    var Content Blob
    var Scrolls bool
    var Padding float64

    func Build() Blob {
        let workspace = Container{
            Key: "workspace",
            FlexGrow: 1,
            FlexShrink: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            Background,
            Bar,
        }
        if let navigation = Navigation {
            workspace.Children.Add(navigation)
        }
        workspace.Children.Add(
            Container{
                Key: "content-scroll",
                FlexGrow: 1,
                FlexShrink: 1,
                FlexBasis: 0,
                MinWidth: 0,
                MinHeight: 0,
                OverflowX: Overflow.Hidden,
                OverflowY: Scrolls ? Overflow.Scroll: Overflow.Hidden,
                Padding: Padding,
                Content,
            }
        )
        return workspace
    }
}
