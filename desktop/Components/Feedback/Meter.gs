package TokateDesktop

import Goo
import System

/// A bar that fills to `Value`, from 0 to 1, across parts of relative size. The labels sit below, spread
/// from the start to the end.
data struct Meter {
    var Value float64
    var Parts []float64
    var Labels []string

    func Build() Blob {
        let p = AppTheme.Current
        let track = Container{FlexDirection: FlexDirection.Row, Gap: 3, Height: 8}
        let legend = Row{Children: []Blob{}, Justify: JustifyContent.SpaceBetween}.Build()
        for i in 0 ... Parts.Length {
            track.Children.Add(
                Container{
                    FlexGrow: Parts[i],
                    FlexBasis: 0,
                    BorderRadius: 2,
                    BackgroundColor: AppTheme.Mix(p.Surface, p.Muted, 0.24),
                }
            )
            legend.Children.Add(Label{Content: Labels[i], Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        track.Children.Add(
            Container{
                Position: PositionType.Absolute,
                Left: 0,
                Top: 0,
                Bottom: 0,
                Width: Percent(Math.Clamp(Value, 0, 1) * 100),
                BorderRadius: 2,
                BackgroundColor: p.Accent,
            }
        )
        return Container{Gap: 8, track, legend}
    }
}
