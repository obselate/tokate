package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// One choice from a set, drawn as a column of radio buttons.
data struct Choices {
    var Name string
    var Labels []string
    var Selected int32
    var OnChoose Action[int32]?
    var Disabled bool

    func Build() Blob {
        let p = AppTheme.Current
        let choose = OnChoose
        let group = Container{
            Gap: AppTheme.Space4,
            AlignItems: AlignItems.FlexStart,
            Accessibility: Accessibility{Role: AccessibilityRole.Group, Name: Name},
        }
        for i in 0 ... Labels.Length {
            let index = i
            let chosen = i == Selected
            group.Children.Add(
                Interaction.Keyboard(
                    Button{
                        MaxWidth: Percent(100),
                        MinHeight: AppTheme.CompactButtonHeight,
                        Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space12, Top: AppTheme.Space4, Bottom: AppTheme.Space4},
                        Gap: AppTheme.Space12,
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        BackgroundColor: Color.Transparent,
                        BorderRadius: AppTheme.ControlRadius,
                        Disabled: Disabled,
                        Focusable: true,
                        Focus: AppTheme.FocusStyle(),
                        Hover: Style{BackgroundColor: p.Paper},
                        Accessibility: Accessibility{
                            Role: AccessibilityRole.Radio,
                            Name: Labels[i],
                            Checked: chosen ? AccessibilityChecked.True: AccessibilityChecked.False,
                        },
                        OnClick: () -> choose?.Invoke(index),
                        MaterialIcons.Create(chosen ? "radio_button_checked": "radio_button_unchecked", 22, chosen ? p.Accent: p.Muted),
                        Container{FlexShrink: 1, MinWidth: 0, Label{Content: Labels[i]}.Build()},
                    }
                )
            )
        }
        return group
    }
}
