package TokateDesktop

import Goo

/// A bordered surface for the lines of a list, below a heading with the count of lines on its baseline. A
/// count below zero does not show.
/// `Trailing` blobs sit at the end of the heading row. `Note` is small text below the lines.
data struct ListSection {
    var Title string
    var Count int32
    var Trailing []Blob
    var Children []Blob
    var Note string
    var Scrolls bool

    func Build() Container {
        let p = AppTheme.Current
        let head = Row{
            Children: []Blob{
                Row{
                    Align: AlignItems.Baseline,
                    Gap: AppTheme.Space12,
                    NoWrap: true,
                    Children: []Blob{
                        Heading{Content: Title, Size: AppTheme.ItemSize}.Build(),
                        Label{Content: Count < 0 ? "": Count.ToString(), Size: AppTheme.SmallSize, Muted: true}.Build(),
                    },
                }.Build(),
                Spacer{}.Build(),
            },
        }.Build()
        head.MinHeight = AppTheme.RowHeight
        head.Padding = Edges{Left: AppTheme.CardPadding, Right: AppTheme.CardPadding, Top: AppTheme.Space12, Bottom: AppTheme.Space12}
        for item in Trailing ?? []Blob{} {
            head.Children.Add(item)
        }
        let panel = Container{
            FlexShrink: 0,
            Overflow: Overflow.Hidden,
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.PanelRadius,
            head,
        }
        if Scrolls {
            panel.FlexShrink = 1
            panel.MinHeight = 0
            panel.OverflowY = Overflow.Scroll
        }
        for child in Children ?? []Blob{} {
            panel.Children.Add(Rule{}.Build())
            panel.Children.Add(child)
        }
        if (Note ?? "") != "" {
            panel.Children.Add(Rule{}.Build())
            panel.Children.Add(
                Container{
                    Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space24, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
                    Label{Content: Note, Size: AppTheme.SmallSize, Muted: true}.Build(),
                }
            )
        }
        return panel
    }
}
