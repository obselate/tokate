package TokateDesktop

import Goo
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

/// Streaming command output that follows new lines until the reader scrolls back. Only the visible lines
/// are built, and an update costs time for the new and dropped lines only, not the whole log. Home and End jump
/// to either end, and "Follow live" resumes following while the command runs. The header shows the
/// blobs `Leading` builds on the left and those `Trailing` builds on the right. They are builders because
/// the log rebuilds on its own, and blobs from an earlier build must not be reused.
open class ActivityLog : Cell[ActivityLogInput] {
    private let viewport ElementHandle = ElementHandle()
    private var scrollRange float64
    private var offset float64
    private var follow bool = true
    private var lines IReadOnlyList[OutputLine] = []OutputLine{}
    private var rowTheme float64 = -1
    private var rowName string = ""
    private var row Func[OutputLine, Blob]? = nil
    private let rowKey Func[OutputLine, string] = (line OutputLine) -> line.Key

    init() {
        viewport.MetricsChanged += metrics -> {
            let following = scrollRange - offset <= 2
            let changed = metrics.ScrollRange.Y != scrollRange
            if metrics.ScrollOffset.Y < Math.Min(offset, metrics.ScrollRange.Y) - 1 {
                follow = false
                Rebuild()
            }
            scrollRange = metrics.ScrollRange.Y
            offset = metrics.ScrollOffset.Y
            if changed && following && follow {
                if lines.Count > 0 {
                    ScrollToEnd()
                } else {
                    viewport.ScrollTo(0, scrollRange)
                }
            }
        }
    }

    private func ScrollToEnd() {
        if lines.Count > 0 {
            viewport.ScrollToItem(lines[lines.Count - 1].Key)
        }
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
        var output Blob
        if input.Lines.Count > 0 {
            lines = input.Lines
            output = VirtualLog(lines, lines[0].Position, 22, rowKey, builder)
        } else {
            lines = []OutputLine{OutputLine{Position: -1, Content: input.Placeholder}}
            output = VirtualRows(lines, 22, rowKey, builder)
        }
        output.Handle = viewport
        output.Accessibility = Accessibility{Role: AccessibilityRole.Generic, Name: input.Name}
        output.FlexGrow = input.Short ? 0: 1
        output.FlexBasis = input.Short ? Length.Auto: Length(0)
        output.MinHeight = input.Short ? 240: 0
        output.Focusable = true
        output.OnKeyDown = event -> {
            if event.Key == Key.Home {
                follow = false
                viewport.JumpTo(0, 0)
                event.PreventDefault()
            } else if event.Key == Key.End {
                follow = true
                ScrollToEnd()
                event.PreventDefault()
            }
        }
        let header = Row{Children: input.Leading?.Invoke() ?? []Blob{}, Gap: 12}.Build()
        header.Padding = Edges{Left: 22, Right: 10, Top: 8, Bottom: 8}
        header.MinHeight = 52
        header.Children.Add(Spacer{}.Build())
        if input.Running && !follow {
            header.Children.Add(
                (input.FollowButton with{
                    Label = "Follow live",
                    Kind = ButtonKind.Quiet,
                    Icon = "south",
                    AllowWhileBusy = true,
                    OnClick = () -> {
                        follow = true
                        ScrollToEnd()
                        Rebuild()
                    },
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
