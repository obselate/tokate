package TokateDesktop

import Goo
import System
import System.Collections.Generic

data struct TabRowInput {
    var Button CommandButton
    var Tabs []string
    var Selected int32
    var Counts []int32
    var OnSelect Action[int32]?
}

/// Tabs that change the view. An accent line below the selected tab slides to the next selected tab.
/// A count above zero shows after its tab. Each tab is derived from `Button`.
open class TabRow : Cell[TabRowInput] {
    private let row ElementHandle = ElementHandle()
    private var tabs []ElementHandle = []ElementHandle{}

    init() {
        row.MetricsChanged += metrics -> Rebuild()
    }

    protected override func Build(input TabRowInput) Blob {
        if tabs.Length != input.Tabs.Length {
            let handles = List[ElementHandle]()
            for name in input.Tabs {
                let handle = ElementHandle()
                handle.MetricsChanged += metrics -> Rebuild()
                handles.Add(handle)
            }
            tabs = handles.ToArray()
        }
        let p = AppTheme.Current
        let choose = input.OnSelect
        let counts = input.Counts ?? []int32{}
        let tab = tabs[input.Selected].BorderBox
        let origin = row.BorderBox
        let strip = Container{
            Handle: row,
            Position: PositionType.Relative,
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            Gap: 4,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: p.Line,
        }
        for i in 0 ... input.Tabs.Length {
            let index = i
            strip.Children.Add(
                Container{
                    Handle: tabs[i],
                    (input.Button with{
                        Label = input.Tabs[i],
                        Kind = ButtonKind.Tab,
                        Primary = i == input.Selected,
                        Count = i < counts.Length ? counts[i]: 0,
                        OnClick = () -> choose?.Invoke(index),
                    }).Build(),
                }
            )
        }
        if tab.Width > 0 {
            strip.Children.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: tab.X - origin.X,
                    Top: tab.Y - origin.Y + tab.Height - 2,
                    Width: tab.Width,
                    Height: 2,
                    BackgroundColor: p.Accent,
                    TransitionMs: AppTheme.Motion ? 220: 0,
                    TransitionEasing: Easing.EaseInOut,
                    TransitionProperties: []TransitionProperty{TransitionProperty.Left, TransitionProperty.Top, TransitionProperty.Width},
                }
            )
        }
        return strip
    }

    shared {
        func Mount(key string, input TabRowInput) Blob -> Container{FlexShrink: 0, Cell.Mount[TabRowInput, TabRow](key, input)}
    }
}
