package TokateDesktop

import Goo

/// Primary navigation: a left rail with a header, or a top bar when compact. The header moves the window when
/// dragged. `Footer` items sit at the bottom of the rail and at the end of the bar.
data struct NavRail {
    var Header Blob?
    var Items []Blob
    var Footer []Blob
    var Compact bool
    var Narrow bool

    func Build() Blob {
        let items = Items ?? []Blob{}
        let footer = Footer ?? []Blob{}
        if Compact {
            let bar = Container{
                Key: "navigation",
                Height: AppTheme.ButtonHeight,
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space8, Bottom: AppTheme.Space4},
                Gap: AppTheme.Space4,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: AppTheme.Current.Line,
            }
            for item in items {
                bar.Children.Add(item)
            }
            for item in footer {
                bar.Children.Add(item)
            }
            return bar
        }
        let rail = Container{
            Key: "navigation",
            Width: Narrow ? AppTheme.NarrowRailWidth: AppTheme.RailWidth,
            FlexShrink: 0,
            Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space24, Bottom: AppTheme.Space24},
            BorderWidth: Edges{Right: 1},
            BorderColor: AppTheme.Current.Line,
            Gap: AppTheme.Space12,
        }
        if let header = Header {
            rail.Children.Add(Window.DragRegion(Container{Padding: Edges{Top: AppTheme.Space24}, header}))
            rail.Children.Add(Rule{Spacing: AppTheme.Space16}.Build())
        } else {
            rail.Padding = Edges{Left: AppTheme.Space24, Right: AppTheme.Space24, Top: AppTheme.Space24, Bottom: AppTheme.Space24}
        }
        for item in items {
            rail.Children.Add(item)
        }
        rail.Children.Add(Spacer{}.Build())
        for item in footer {
            rail.Children.Add(item)
        }
        return rail
    }
}
