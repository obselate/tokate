package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// A text link that sits on the painting or on painted stone, with no surface of its own. `Detail` follows the
/// label in `DetailInk`.
data struct PaintedLink {
    var Label string
    var Detail string
    var Ink Color
    var DetailInk Color
    var OnClick Action?

    func Build() Blob {
        let click = OnClick
        let words = List[Blob]{
            Text{
                Content: Label,
                FontFamily: AppTheme.BodyFont,
                FontSize: AppTheme.BodySize,
                Color: Ink,
                TextDecoration: TextDecoration.Underline,
                TextWrap: TextWrap.NoWrap,
                TextTrimming: TextTrimming.Ellipsis,
                MinWidth: 0,
                FlexShrink: 1,
            },
        }
        if (Detail ?? "") != "" {
            words.Add(Text{Content: Detail, FontFamily: AppTheme.BodyFont, FontSize: AppTheme.SmallSize, Color: DetailInk, FlexShrink: 0})
        }
        return Interaction.Keyboard(
            Button{
                MaxWidth: Percent(100),
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Baseline,
                Gap: AppTheme.Space12,
                Padding: Edges{Left: AppTheme.Space12, Right: AppTheme.Space12, Top: AppTheme.Space4, Bottom: AppTheme.Space4},
                BorderRadius: AppTheme.ControlRadius,
                BorderWidth: 0,
                BackgroundColor: Color.Transparent,
                OnClick: () -> click?.Invoke(),
                Focusable: true,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: Label},
                Hover: Style{Opacity: 0.8},
                Focus: AppTheme.FocusStyle(),
                Children: words.ToArray(),
            }
        )
    }
}
