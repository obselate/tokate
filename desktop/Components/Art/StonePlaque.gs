package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// A painted stone tablet for a message that the reader must act on. `Command` follows `Detail` in the
/// monospace face, and `Action` is the one text action below them. The stone is pale in both themes.
data struct StonePlaque {
    var Title string
    var Detail string
    var Command string
    var Action string
    var Stone ImageSource
    var OnAction Action?

    func Build() Blob {
        let day = AppTheme.Daylight
        return Container{
            Width: 560,
            MaxWidth: Percent(100),
            Height: 124,
            Padding: Edges{Left: 84, Right: 84},
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: 2,
            Accessibility: Accessibility{Role: AccessibilityRole.Alert, Name: Title},
            Image{
                Source: Stone,
                Fit: ImageFit.Fill,
                Position: PositionType.Absolute,
                Left: 0,
                Top: Percent(-21),
                Width: Percent(100),
                Height: Percent(142),
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                MaterialIcons.Create("error", 18, day.Accent),
                Text{Content: Title, FontFamily: AppTheme.HeadingFont, FontWeight: 500, FontSize: AppTheme.ItemSize, Color: AppTheme.StoneInk},
            },
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: 7,
                Label{Content: Detail, Size: AppTheme.SmallSize, Ink: day.Muted}.Build(),
                Label{Content: Command, Mono: true, Ink: AppTheme.StoneInk}.Build(),
            },
            PaintedLink{Label: Action, Ink: day.Accent, DetailInk: day.Muted, OnClick: OnAction}.Build(),
        }
    }
}
