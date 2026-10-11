package TokateDesktop

import Goo
import System

/// Tabs that change the view. The selected tab has an accent underline. A count above zero shows after its
/// tab. Each tab is derived from `Button`.
data struct TabRow {
    var Button CommandButton
    var Tabs []string
    var Selected int32
    var Counts []int32
    var OnSelect Action[int32]?

    func Build() Container {
        let choose = OnSelect
        let row = Container{
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            Gap: 4,
            BorderWidth: Edges{Bottom: 1},
            BorderColor: AppTheme.Current.Line,
        }
        for i in 0 ... Tabs.Length {
            let index = i
            row.Children.Add(
                (Button with{
                    Label = Tabs[i],
                    Kind = ButtonKind.Tab,
                    Primary = i == Selected,
                    Count = i < Counts.Length ? Counts[i]: 0,
                    OnClick = () -> choose?.Invoke(index),
                }).Build()
            )
        }
        return row
    }
}
