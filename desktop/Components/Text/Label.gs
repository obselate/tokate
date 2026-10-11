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

    func Build() Text -> Text{
        Content: Content,
        FontFamily: Mono ? AppTheme.MonoFont: AppTheme.BodyFont,
        FontSize: Size != 0 ? Size: Mono ? AppTheme.CodeSize: AppTheme.BodySize,
        Color: Ink ?? (Muted ? AppTheme.Current.Muted: AppTheme.Current.Ink),
    }
}
