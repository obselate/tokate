package TokateDesktop

import Goo
import System

/// A small loading spinner and message. Reduced motion keeps the spinner still.
data struct Loader {
    var Message string
    var Key string

    func Build() Blob -> Row{
        Gap: AppTheme.Space8,
        Name: Message,
        Children: []Blob{
            Container{FlexShrink: 0, Children: []Blob{Cell.Mount[float64, Spinner](Key ?? "inline-loader", 18)}},
            Label{Content: Message, Size: AppTheme.SmallSize, Muted: true}.Build(),
        },
    }.Build()
}

open class Spinner : Cell[float64] {
    private let turn Anim[float64]

    init() {
        turn = Animate(0.0)
        turn.Completed += reason -> {
            if reason == MotionCompletionReason.Finished && AppTheme.Motion {
                Spin()
            }
        }
        if AppTheme.Motion {
            Spin()
        }
    }

    private func Spin() {
        turn.Snap(0.0)
        turn.To(1.0, Motion.Tween(0.9, Easing.Linear))
    }

    protected override func Build(size float64) Blob {
        let spinner = Container{Width: size, Height: size, FlexShrink: 0}
        let phase = AppTheme.Motion ? int32(turn.Value * 8) % 8: 0
        for index in 0 ... 8 {
            let angle = float64(index) * Math.PI / 4
            spinner.Children.Add(Container{
                Position: PositionType.Absolute,
                Width: 3,
                Height: 3,
                Left: size / 2 + (size / 2 - 2) * Math.Cos(angle) - 1.5,
                Top: size / 2 + (size / 2 - 2) * Math.Sin(angle) - 1.5,
                BorderRadius: 2,
                BackgroundColor: AppTheme.Current.Muted,
                Opacity: 0.2 + float64((index - phase + 8) % 8) / 10,
            })
        }
        return spinner
    }
}
