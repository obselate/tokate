package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System

/// A labeled checkbox.
data struct Check {
    var Label string
    var Value bool
    var OnChange Action[bool]?
    var Disabled bool

    func Build() Blob {
        let p = AppTheme.Current
        let change = OnChange
        let checkbox = Checkbox{
            Label: Label,
            State: Value ? AccessibilityChecked.True: AccessibilityChecked.False,
            OnChange: state -> change?.Invoke(state == AccessibilityChecked.True),
            Disabled: Disabled,
            LabelColor: p.Ink,
            LabelFontSize: AppTheme.BodySize,
            LabelFontWeight: 400,
            BackgroundColor: p.Surface,
            CheckedBackgroundColor: p.Ink,
            MarkColor: p.Paper,
            BorderColor: p.Line,
            CheckedBorderColor: p.Ink,
        }.Build()
        checkbox.Focus = AppTheme.FocusStyle()
        return Interaction.RevealFocus(checkbox)
    }
}
