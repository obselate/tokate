package TokateDesktop

import Goo
import System

/// A painted stone button used for the welcome page's main choices.
data struct StoneCard {
    var Title string
    var Stone ImageSource
    var Compact bool
    var OnClick Action?

    func Build() Blob {
        let click = OnClick
        return Interaction.Keyboard(
            Button{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                MaxWidth: 360,
                Height: Compact ? 72: 92,
                Padding: Edges{Left: Compact ? 28: 62, Right: Compact ? 28: 62},
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BorderRadius: AppTheme.PanelRadius,
                BorderWidth: 0,
                BackgroundColor: Color.Transparent,
                OnClick: () -> click?.Invoke(),
                Focusable: true,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: Title},
                Hover: Style{Opacity: 0.92},
                Focus: AppTheme.FocusStyle(),
                Image{
                    Source: Stone,
                    Fit: ImageFit.Fill,
                    Position: PositionType.Absolute,
                    Left: 0,
                    Top: Percent(-21),
                    Width: Percent(100),
                    Height: Percent(142),
                },
                Text{
                    Content: Title,
                    FontFamily: AppTheme.HeadingFont,
                    FontWeight: 500,
                    FontSize: Compact ? AppTheme.BodySize: AppTheme.ItemSize,
                    Color: AppTheme.StoneInk,
                    TextAlign: TextAlign.Center,
                },
            }
        )
    }
}
