package TokateDesktop

import Goo

/// A full-bleed page background. `NightImage` fades in over `Image` with `Twilight`; nil `Opacity` is opaque.
data struct Backdrop {
    var Image ImageSource?
    var NightImage ImageSource?
    var Effect ShaderEffect?
    var Twilight float64
    var Opacity float64?

    func Build() Blob {
        let background = Container{
            Key: "background",
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Top: 0,
            Bottom: 0,
            HitTestSelf: false,
        }
        guard let image = Image else {
            return background
        }
        if let effect = Effect {
            background.ShaderEffect = effect
        }
        if let opacity = Opacity {
            background.Opacity = opacity
        }
        background.Children.Add(
            Goo.Image{Source: image, Fit: ImageFit.Cover, Width: Percent(100), Height: Percent(100)}
        )
        if let night = NightImage {
            background.Children.Add(
                Goo.Image{
                    Source: night,
                    Fit: ImageFit.Cover,
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: 0,
                    Bottom: 0,
                    Opacity: Twilight,
                }
            )
        }
        return background
    }
}
