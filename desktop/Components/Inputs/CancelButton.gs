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
                Padding: Edges{Left: 14, Right: 14, Top: 8, Bottom: 8},
                BorderWidth: 1,
                BorderColor: AppTheme.Current.Line,
                BorderRadius: 4,
                Disabled: Stopping,
                Focusable: true,
                Focus: AppTheme.FocusStyle(),
                Hover: Style{BackgroundColor: AppTheme.Current.Paper},
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Cancel command"},
                OnClick: () -> {
                    cancel?.Invoke()
                },
                Label{Content: Stopping ? "Stopping": "Cancel", Size: 17}.Build(),
            }
        )
    }
}
