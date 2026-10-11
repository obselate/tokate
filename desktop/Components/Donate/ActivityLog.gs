package TokateDesktop

import Goo
import Goo.Widgets.Data
import Goo.Widgets.Icons
import System
import System.Collections.Generic

data struct ActivityLogInput {
    var Lines IReadOnlyList[OutputLine]
    var Revision int64
    var Placeholder string
    var Name string
    var LineName string
    var Running bool
    var Short bool
    var Leading Func[[]Blob]?
    var Trailing Func[[]Blob]?
    var FollowButton CommandButton
}

/// Streaming command output that follows new lines until the reader scrolls back, and again once they return
/// to the end. Only the visible lines are built, and an update builds the new lines only and compares the lines
/// it keeps. Home and End jump to either end, and "Follow live" resumes following while the command runs. The
/// header shows the blobs `Leading` builds on the left and those `Trailing` builds on the right. They are
/// builders because the log rebuilds on its own, and blobs from an earlier build must not be reused.
open class ActivityLog : Cell[ActivityLogInput] {
    private let viewport ElementHandle = ElementHandle()
    private var follow bool = true
    private var rowTheme float64 = -1
    private var rowName string = ""
    private var row Func[OutputLine, Blob]? = nil
    private let rowKey Func[OutputLine, string] = (line OutputLine) -> line.Key

    init() {
        viewport.MetricsChanged += metrics -> {
            let following = metrics.ScrollRange.Y - metrics.ScrollOffset.Y <= 2
            if following != follow {
                follow = following
                Rebuild()
            }
        }
    }

    /// Jumps past the end, which the list clamps to its last line and pins again.
    private func ScrollToEnd() {
        viewport.JumpTo(0, float64(Single.MaxValue))
    }

    /// The row builder, kept between builds so unchanged rows are reused. A new theme or name replaces it.
    private func LineBuilder(name string) Func[OutputLine, Blob] {
        if let current = row {
            if rowTheme == AppTheme.Twilight && rowName == name {
                return current
            }
        }
        rowTheme = AppTheme.Twilight
        rowName = name
        let next = (line OutputLine) -> Container{
            Padding: Edges{Left: 22, Right: 22, Top: 2, Bottom: 2},
            Text{
                Content: line.Content,
                FontFamily: AppTheme.MonoFont,
                FontSize: AppTheme.CodeSize,
                Color: AppTheme.Current.Ink,
                Accessibility: Accessibility{Role: AccessibilityRole.Text, Name: name},
            },
        }
        row = next
        return next
    }

    protected override func Build(input ActivityLogInput) Blob {
        let builder = LineBuilder(input.LineName)
        var lines = input.Lines
        if lines.Count == 0 {
            lines = []OutputLine{OutputLine{Position: -1, Content: input.Placeholder}}
        }
        let output = VirtualRows(lines, 22, rowKey, builder)
        output.PinToBottom = true
        output.Handle = viewport
        output.Accessibility = Accessibility{Role: AccessibilityRole.Generic, Name: input.Name}
        output.FlexGrow = input.Short ? 0: 1
        output.FlexBasis = input.Short ? Length.Auto: Length(0)
        output.MinHeight = input.Short ? 240: 0
        output.Focusable = true
        output.OnKeyDown = event -> {
            if event.Key == Key.Home {
                viewport.JumpTo(0, 0)
                event.PreventDefault()
            } else if event.Key == Key.End {
                ScrollToEnd()
                event.PreventDefault()
            }
        }
        let header = Row{Children: input.Leading?.Invoke() ?? []Blob{}, Gap: 12}.Build()
        header.Padding = Edges{Left: 22, Right: 10, Top: 4, Bottom: 4}
        header.MinHeight = 44
        header.Children.Add(Spacer{}.Build())
        if input.Running && !follow {
            header.Children.Add(
                (input.FollowButton with{
                    Label = "Follow live",
                    Kind = ButtonKind.Quiet,
                    Icon = "south",
                    AllowWhileBusy = true,
                    OnClick = ScrollToEnd,
                }).Build()
            )
        }
        for item in input.Trailing?.Invoke() ?? []Blob{} {
            header.Children.Add(item)
        }
        return Container{
            FlexGrow: input.Short ? 0: 1,
            FlexBasis: input.Short ? Length.Auto: Length(0),
            MinHeight: 0,
            header,
            Rule{}.Build(),
            output,
        }
    }

    shared {
        /// Mounts the log in a container that fills the remaining height, so it can sit among unkeyed siblings.
        func Mount(key string, input ActivityLogInput) Blob -> Container{
            FlexGrow: input.Short ? 0: 1,
            FlexBasis: input.Short ? Length.Auto: Length(0),
            MinHeight: 0,
            Children: []Blob{Cell.Mount[ActivityLogInput, ActivityLog](key, input)},
        }
    }
}
