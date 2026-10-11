package TokateDesktop

import Goo
import System

/// A page summary with previous and next icon buttons derived from `Button`. Narrow pagers stack.
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
                (Button with{
                    Label = "Previous page",
                    Kind = ButtonKind.Icon,
                    Icon = "chevron_left",
                    Primary = false,
                    OnClick = () -> change?.Invoke(page - 1),
                    Disabled = page <= 1,
                }).Build(),
                (Button with{
                    Label = "Next page",
                    Kind = ButtonKind.Icon,
                    Icon = "chevron_right",
                    Primary = false,
                    OnClick = () -> change?.Invoke(page + 1),
                    Disabled = page >= LastPage,
                }).Build(),
            },
            Gap: 8,
            Justify: JustifyContent.FlexEnd,
        }.Build()
        buttons.FlexGrow = Narrow ? 0: 1
        return Container{
            FlexDirection: Narrow ? FlexDirection.Column: FlexDirection.Row,
            AlignItems: Narrow ? AlignItems.Stretch: AlignItems.Center,
            Gap: 12,
            Label{
                Content: "Page " + Page.ToString() + " of " + LastPage.ToString() + "  ·  " + Summary,
                Size: AppTheme.SmallSize,
                Muted: true,
            }.Build(),
            buttons,
        }
    }
}
