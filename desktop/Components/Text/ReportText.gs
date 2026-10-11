package TokateDesktop

import Goo

/// Scrollable monospace output such as command reports. Zero size resolves to the code size and zero height to 300.
data struct ReportText {
    var Content string
    var Size float64
    var MaxHeight float64

    func Build() Text -> Text{
        Content: Content,
        FontFamily: AppTheme.MonoFont,
        FontSize: Size == 0 ? AppTheme.CodeSize: Size,
        Color: AppTheme.Current.Ink,
        MaxHeight: MaxHeight == 0 ? 300: MaxHeight,
        OverflowY: Overflow.Scroll,
    }
}
