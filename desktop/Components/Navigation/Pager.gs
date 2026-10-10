package TokateDesktop

import Goo
import System

/// Previous and next page buttons with a page summary. Buttons are derived from `Button`; narrow pagers stack.
data struct Pager {
    var Button CommandButton
    var Page int32
    var LastPage int32
    var Summary string
    var Narrow bool
    var OnChange Action[int32]?

    func Build() Blob {
        let change = OnChange
        let page = Page
        let buttons = Row{
            Children: []Blob{
                (Button with{Label = "Previous page", Primary = false, OnClick = () -> change?.Invoke(page - 1), Disabled = page <= 1}).Build(),
                (Button with{Label = "Next page", Primary = false, OnClick = () -> change?.Invoke(page + 1), Disabled = page >= LastPage}).Build(),
            },
            Justify: JustifyContent.FlexEnd,
        }.Build()
        buttons.FlexGrow = Narrow ? 0: 1
        return Container{
            FlexDirection: Narrow ? FlexDirection.Column: FlexDirection.Row,
            AlignItems: Narrow ? AlignItems.Stretch: AlignItems.Center,
            Gap: 12,
            Label{
                Content: "Page " + Page.ToString() + " of " + LastPage.ToString() + "  ·  " + Summary,
                Size: 17,
            }.Build(),
            buttons,
        }
    }
}
