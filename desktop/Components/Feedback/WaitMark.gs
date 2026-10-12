package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

data struct WaitMarkInput {
    var Icon string
    var Size float64
    var Ink Color
}

/// The icon of a state that waits for another process or person. It fades out and in while it waits.
/// Without motion it is still.
open class WaitMark : Cell[WaitMarkInput] {
    private let fade Anim[float64]
    private var dim bool

    init() {
        fade = Animate(1.0)
        fade.Completed += reason -> {
            if reason == MotionCompletionReason.Finished && AppTheme.Motion {
                Turn()
            }
        }
        if AppTheme.Motion {
            Turn()
        }
    }

    private func Turn() {
        dim = !dim
        fade.To(dim ? 0.3: 1.0, Motion.Tween(1.1, Easing.EaseInOut))
    }

    protected override func Build(input WaitMarkInput) Blob -> Container{
        Opacity: AppTheme.Motion ? fade.Value: 1,
        MaterialIcons.Create(input.Icon, input.Size, input.Ink),
    }

    shared {
        /// Mounts the mark in a container, so it can sit among unkeyed siblings.
        func Mount(key string, input WaitMarkInput) Blob -> Container{
            FlexShrink: 0,
            Children: []Blob{Cell.Mount[WaitMarkInput, WaitMark](key, input)},
        }
    }
}
