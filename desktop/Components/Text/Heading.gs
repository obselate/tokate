package TokateDesktop

import Goo

/// Display text in the heading face. Zero size resolves to the title size and nil ink to the theme ink.
/// Text that is longer than `MaxLines` ends with an ellipsis.
data struct Heading {
    var Content string
    var Size float64
    var Italic bool
    var Ink Color?
    var MaxLines int32

    func Build() Text {
        let text = Text{
            Content: Content,
            FontFamily: AppTheme.HeadingFont,
            FontWeight: 500,
            FontSize: Size == 0 ? AppTheme.TitleSize: Size,
            Color: Ink ?? AppTheme.Current.Ink,
        }
        if Italic {
            text.FontStyle = FontStyle.Italic
        }
        if MaxLines > 0 {
            text.TextMaxLines = MaxLines
            text.TextTrimming = TextTrimming.Ellipsis
        }
        return text
    }
}
