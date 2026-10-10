package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

data struct LogLine {
    var Index int32
    var Content string
    var Theme float64
}

data struct ActivityLogInput {
    var Output string
    var Placeholder string
    var Name string
    var LineName string
    var Running bool
    var Short bool
    var Leading []Blob
    var Trailing []Blob
    var FollowButton CommandButton
}

/// Streaming command output that follows new lines until the reader scrolls back. Home and End jump
/// to either end, and "Follow live" resumes following while the command runs. The footer shows
/// `Leading` on the left and `Trailing` on the right.
open class ActivityLog : Cell[ActivityLogInput] {
    private let viewport ElementHandle = ElementHandle()
    private var scrollRange float64
    private var offset float64
    private var follow bool = true
    private var rendered string = ""
    private var renderedTheme float64 = -1
    private var lines List[LogLine] = List[LogLine]()

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
            viewport.ScrollToItem(lines[lines.Count - 1].Index.ToString())
        }
    }

    protected override func Build(input ActivityLogInput) Blob {
        let p = AppTheme.Current
        if rendered != input.Output || renderedTheme != AppTheme.Twilight || lines.Count == 0 {
            rendered = input.Output
            renderedTheme = AppTheme.Twilight
            let rows = List[LogLine]()
            let text = (input.Output == "" ? input.Placeholder: input.Output).Split('\n')
            for i in 0 ... text.Length {
                if !String.IsNullOrWhiteSpace(text[i]) {
                    rows.Add(LogLine{Index: i, Content: text[i].TrimEnd('\r'), Theme: renderedTheme})
                }
            }
            lines = rows
        }
        let lineName = input.LineName
        let output = VirtualRows(
            lines,
            64,
            (line LogLine) -> line.Index.ToString(),
            (line LogLine) -> Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: 14,
                Padding: Edges{Left: 22, Right: 22, Top: 16, Bottom: 16},
                BorderWidth: Edges{Bottom: 1},
                BorderColor: AppTheme.Current.Line,
                MaterialIcons.Create("chevron_right", 18, AppTheme.Current.Accent),
                Text{
                    Content: line.Content,
                    FontFamily: AppTheme.BodyFont,
                    FontSize: 18,
                    Color: AppTheme.Current.Ink,
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    Accessibility: Accessibility{Role: AccessibilityRole.Text, Name: lineName},
                },
            }
        )
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
        let footer = Row{Children: input.Leading ?? []Blob{}, Gap: 16}.Build()
        footer.Padding = Edges{Left: 18, Right: 18, Top: 12, Bottom: 12}
        footer.Children.Add(Spacer{}.Build())
        if input.Running && !follow {
            footer.Children.Add(
                (input.FollowButton with{
                    Label = "Follow live",
                    AllowWhileBusy = true,
                    OnClick = () -> {
                        follow = true
                        ScrollToEnd()
                        Rebuild()
                    },
                }).Build()
            )
        }
        for item in input.Trailing ?? []Blob{} {
            footer.Children.Add(item)
        }
        return Container{
            FlexGrow: input.Short ? 0: 1,
            FlexBasis: input.Short ? Length.Auto: Length(0),
            MinHeight: 0,
            output,
            Rule{}.Build(),
            footer,
        }
    }

    shared {
        func Mount(key string, input ActivityLogInput) Blob -> Cell.Mount[ActivityLogInput, ActivityLog](key, input)
    }
}
