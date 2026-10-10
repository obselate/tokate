package TokateDesktop

import Goo

/// Body text. Zero size resolves to 18; muted text uses the theme's muted ink.
data struct Label {
    var Content string
    var Size float64
    var Muted bool
    var Ink Color?

    func Build() Text -> Text{
        Content: Content,
        FontFamily: AppTheme.BodyFont,
        FontSize: Size == 0 ? 18: Size,
        Color: Ink ?? (Muted ? AppTheme.Current.Muted: AppTheme.Current.Ink),
    }
}
