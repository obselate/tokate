package TokateDesktop

import Goo
import System

/// The standalone control that cancels the active command.
data struct CancelButton {
    var Stopping bool
    var OnCancel Action?

    func Build() Blob {
        let cancel = OnCancel
        return Interaction.Keyboard(
            Button{
                Height: AppTheme.ButtonHeight,
                MinWidth: AppTheme.ButtonMinWidth,
                Padding: Edges{Left: AppTheme.Space16, Right: AppTheme.Space16},
                BorderWidth: 1,
                BorderColor: AppTheme.Current.Line,
                BorderRadius: AppTheme.ControlRadius,
                Disabled: Stopping,
                Focusable: true,
                Focus: AppTheme.FocusStyle(),
                Hover: Style{BackgroundColor: AppTheme.Current.Paper},
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Cancel command"},
                OnClick: () -> {
                    cancel?.Invoke()
                },
                Label{Content: Stopping ? "Stopping": "Cancel", Size: AppTheme.SmallSize}.Build(),
            }
        )
    }
}
