package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System

/// A labeled single-line text field. Zero width resolves to 400.
data struct InputField {
    var Label string
    var Value string
    var OnChange Action[string]?
    var Placeholder string
    var Width float64
    var OnSubmit Action?
    var Disabled bool

    func Build() Blob {
        let p = AppTheme.Current
        let change = OnChange
        let submit = OnSubmit
        let field = TextField{
            Label: Label,
            Value: Value,
            OnChange: value -> change?.Invoke(value),
            OnSubmit: _ -> submit?.Invoke(),
            Placeholder: Placeholder ?? "",
            Width: Width == 0 ? 400: Width,
            FontFamily: AppTheme.BodyFont,
            FontSize: AppTheme.BodySize,
            LabelFontSize: AppTheme.SmallSize,
            LabelFontWeight: 400,
            LabelTextTransform: TextTransform.None,
            EntryHeight: 44,
            BackgroundColor: p.Surface,
            TextColor: p.Ink,
            DisabledBackgroundColor: p.Surface,
            DisabledTextColor: p.Muted,
            MutedTextColor: p.Muted,
            BorderColor: p.Line,
            FocusColor: p.Accent,
            ShowFocusHighlight: AppTheme.FocusVisible,
            Disabled: Disabled,
            TransitionMs: 0,
        }.Build()
        field.MaxWidth = Percent(100)
        field.FlexShrink = 1
        return Interaction.RevealFocus(field)
    }
}
