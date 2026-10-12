package TokateDesktop

import Goo

/// Body text. Zero size resolves to the body size; muted text uses the theme's muted ink. `Mono` sets
/// commands, paths and commits in the monospace face at the code size.
data struct Label {
    var Content string
    var Size float64
    var Muted bool
    var Mono bool
    var Ink Color?
    /// The most lines to show. Longer text ends with an ellipsis. Zero shows all lines.
    var MaxLines int32

    func Build() Text {
        let text = Text{
            Content: Content,
            FontFamily: Mono ? AppTheme.MonoFont: AppTheme.BodyFont,
            FontSize: Size != 0 ? Size: Mono ? AppTheme.CodeSize: AppTheme.BodySize,
            Color: Ink ?? (Muted ? AppTheme.Current.Muted: AppTheme.Current.Ink),
        }
        if MaxLines > 0 {
            text.TextMaxLines = MaxLines
            text.TextTrimming = TextTrimming.Ellipsis
        }
        return text
    }
}
