package TokateDesktop

import Goo
import System

/// One choice from a set, drawn as joined segments. Each segment is derived from `Button`.
data struct PresetGroup {
    var Button CommandButton
    var Labels []string
    var Selected int32
    var Unavailable []bool
    var OnChoose Action[int32]?

    func Build() Container {
        let p = AppTheme.Current
        let group = Container{
            FlexDirection: FlexDirection.Row,
            FlexWrap: FlexWrap.Wrap,
            AlignSelf: AlignSelf.FlexStart,
            Gap: 2,
            Padding: 3,
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.ControlRadius,
        }
        let choose = OnChoose
        for i in 0 ... Labels.Length {
            let index = i
            let unavailable = i < Unavailable.Length && Unavailable[i]
            group.Children.Add(
                (Button with{
                    Label = Labels[i],
                    Kind = ButtonKind.Segment,
                    OnClick = () -> choose?.Invoke(index),
                    Primary = i == Selected,
                    Disabled = unavailable,
                }).Build()
            )
        }
        return group
    }
}
