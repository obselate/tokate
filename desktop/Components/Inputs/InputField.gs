package TokateDesktop

import Goo
import Goo.Widgets.Inputs
import System

/// A labeled single-line text field. Zero width resolves to 400. A bare field shows no label and keeps it
/// as the accessible name. `Fill` takes the free width of a row. `Problem` marks the field as invalid and
/// shows the reason below it.
///
/// Goo applies `Value` only while the field does not have focus. `Controlled` applies it with focus too,
/// which a field needs when the app can change its value under the focus, such as a row of a list.
data struct InputField {
    var Label string
    var Value string
    var OnChange Action[string]?
    var Placeholder string
    var Width float64
    var OnSubmit Action?
    var Disabled bool
    var Bare bool
    var Fill bool
    var Controlled bool
    var Problem string

    func Build() Blob {
        let p = AppTheme.Current
        let change = OnChange
        let submit = OnSubmit
        let problem = Problem ?? ""
        var entry Func[TextField, TextEntry]? = nil
        if Controlled {
            entry = resolved -> InputField.ControlledEntry(resolved)
        }
        let field = TextField{
            Label: Bare ? nil: Label,
            AccessibilityName: Label,
            Value: Value,
            OnChange: value -> change?.Invoke(value),
            OnSubmit: _ -> submit?.Invoke(),
            Placeholder: Placeholder ?? "",
            Width: Width == 0 ? AppTheme.FieldWidth: Width,
            FontFamily: AppTheme.BodyFont,
            FontSize: AppTheme.BodySize,
            LabelFontSize: AppTheme.LabelSize,
            LabelFontWeight: 400,
            LabelTextTransform: TextTransform.None,
            EntryHeight: AppTheme.FieldHeight,
            Gap: AppTheme.Space8,
            PaddingHorizontal: AppTheme.Space12,
            BorderRadius: AppTheme.ControlRadius,
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
            IssueText: problem == "" ? nil: problem,
            Invalid: problem != "",
            InvalidColor: p.Fail,
            IssueFontSize: AppTheme.SmallSize,
            CreateEntry: entry,
        }.Build()
        field.MaxWidth = Percent(100)
        field.FlexShrink = 1
        if Fill {
            field.FlexGrow = 1
            field.FlexBasis = 0
            field.MinWidth = 0
        }
        return Interaction.RevealFocus(field)
    }

    shared {
        /// The entry that `TextField` builds, with `Controlled` set. The widget does not offer the setting.
        private func ControlledEntry(field TextField) TextEntry {
            let accent = field.Invalid ? field.InvalidColor!!: field.FocusColor!!
            return TextEntry{
                Width: Percent(100),
                Height: field.EntryHeight,
                Padding: Edges{Left: field.PaddingHorizontal, Right: field.PaddingHorizontal},
                BackgroundColor: field.BackgroundColor!!,
                Color: field.TextColor!!,
                BorderColor: field.Invalid ? field.InvalidColor!!: field.BorderColor!!,
                BorderWidth: field.BorderWidth!!,
                BorderRadius: field.BorderRadius!!,
                FontFamily: field.FontFamily!!,
                FontSize: field.FontSize,
                Value: field.Value!!,
                Controlled: true,
                Placeholder: field.Placeholder!!,
                OnChange: field.OnChange,
                OnSubmit: field.OnSubmit,
                Disabled: field.Disabled,
                TransitionMs: field.TransitionMs!!,
                Focus: field.ShowFocusHighlight ? Style{BorderColor: accent, BoxShadow: BoxShadow{Color: accent, Spread: field.FocusRingWidth!!}}: Style{},
                DisabledStyle: Style{BackgroundColor: field.DisabledBackgroundColor!!, Color: field.DisabledTextColor!!},
                Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: field.AccessibilityName!!},
            }
        }
    }
}
