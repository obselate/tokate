package TokateDesktop

import Goo
import System

/// A bar that fills to `Value`, from 0 to 1, across parts of relative size.
data struct Meter {
    var Value float64
    var Parts []float64

    func Build() Blob {
        let p = AppTheme.Current
        let track = Container{FlexDirection: FlexDirection.Row, Gap: 3, Height: 8}
        for i in 0 ... Parts.Length {
            track.Children.Add(
                Container{
                    FlexGrow: Parts[i],
                    FlexBasis: 0,
                    BorderRadius: 2,
                    BackgroundColor: AppTheme.Mix(p.Surface, p.Muted, 0.24),
                }
            )
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
        return track
    }
}
