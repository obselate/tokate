package TokateDesktop

import Goo
import System

data struct SkyLoaderInput {
    var Message string
    var Sun ImageSource
    var Moon ImageSource
    var Twilight float64
}

/// The loading state of a list: the painted sun, or the moon at night, rises and sets behind a horizon line
/// above `Message`. Without motion it rests at its highest point.
open class SkyLoader : Cell[SkyLoaderInput] {
    private let arc Anim[float64]
    private var still bool = !AppTheme.Motion

    init() {
        arc = Animate(0.0)
        arc.Completed += reason -> {
            if reason == MotionCompletionReason.Finished && AppTheme.Motion {
                Rise()
            } else {
                still = true
                Rebuild()
            }
        }
        if !still {
            Rise()
        }
    }

    private func Rise() {
        arc.Snap(0.0)
        arc.To(1.0, Motion.Tween(3.6, Easing.EaseInOut))
    }

    protected override func Build(input SkyLoaderInput) Blob {
        let progress = still ? 0.5: arc.Value
        let left = progress * (SkyWidth - OrbSize)
        let top = SkyHeight - Math.Sin(progress * Math.PI) * (SkyHeight - 4)
        let message = Label{Content: input.Message, Size: AppTheme.ItemSize, Muted: true}.Build()
        message.TextAlign = TextAlign.Center
        return Container{
            FlexGrow: 1,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: AppTheme.Space16,
            Padding: AppTheme.Space24,
            Container{
                Width: SkyWidth,
                Height: SkyHeight,
                FlexShrink: 0,
                Overflow: Overflow.Hidden,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: AppTheme.Current.Line,
                Orb(input.Sun, 1 - input.Twilight, left, top),
                Orb(input.Moon, input.Twilight, left, top),
            },
            message,
        }
    }

    private func Orb(source ImageSource, opacity float64, left float64, top float64) Blob -> Image{
        Source: source,
        Opacity: opacity,
        Width: OrbSize,
        Height: OrbSize,
        Fit: ImageFit.Contain,
        Position: PositionType.Absolute,
        Left: left,
        Top: top
    }

    shared {
        let SkyWidth float64 = 176
        let SkyHeight float64 = 56
        let OrbSize float64 = 44

        /// Mounts the loader in a container that fills the list, so it can sit among unkeyed siblings.
        func Mount(input SkyLoaderInput) Blob -> Container{
            FlexGrow: 1,
            Children: []Blob{Cell.Mount[SkyLoaderInput, SkyLoader]("sky-loader", input with{Twilight = AppTheme.Twilight})},
        }
    }
}
