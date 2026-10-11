package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// The command that runs on another page: its title and elapsed time, a control that shows its page, and
/// Cancel. Compact chips drop the title.
data struct ActivityChip {
    var Title string
    var Elapsed string
    var Stopping bool
    var Pulse float64
    var Compact bool
    var OnOpen Action?
    var OnCancel Action?

    func Build() Blob {
        let p = AppTheme.Current
        let show = OnOpen
        let cancel = OnCancel
        let summary = Button{
            Height: 30,
            Padding: Edges{Left: 10, Right: 8},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            BorderWidth: 0,
            BackgroundColor: Color.Transparent,
            Hover: Style{BackgroundColor: p.Paper},
            Focus: AppTheme.FocusStyle(),
            Focusable: true,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Show " + Title},
            OnClick: () -> show?.Invoke(),
            MaterialIcons.Create("auto_awesome", 16, p.Accent),
            Label{Content: Elapsed, Size: AppTheme.SmallSize, Muted: true}.Build(),
        }
        if !Compact {
            summary.Children.Insert(1, Label{Content: Title, Size: AppTheme.SmallSize}.Build())
        }
        return Container{
            Height: 32,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Overflow: Overflow.Hidden,
            BackgroundColor: p.Surface,
            BorderWidth: 1,
            BorderColor: p.Line,
            BorderRadius: AppTheme.ControlRadius,
            Interaction.Keyboard(summary),
            Interaction.Keyboard(
                Button{
                    Height: 30,
                    Padding: Edges{Left: 8, Right: 10},
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    BorderWidth: 0,
                    BackgroundColor: Color.Transparent,
                    Hover: Style{BackgroundColor: p.Paper},
                    Focus: AppTheme.FocusStyle(),
                    Focusable: true,
                    Disabled: Stopping,
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Cancel command"},
                    OnClick: () -> cancel?.Invoke(),
                    Label{Content: Stopping ? "Stopping": "Cancel", Size: AppTheme.SmallSize}.Build(),
                }
            ),
            Container{
                Position: PositionType.Absolute,
                Left: 8,
                Right: 8,
                Bottom: 2,
                Height: 2,
                BorderRadius: 1,
                BackgroundColor: p.Accent,
                Opacity: AppTheme.Motion ? Pulse: 1,
            },
        }
    }
}
