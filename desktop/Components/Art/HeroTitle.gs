package TokateDesktop

import Goo
import System

/// The two-line welcome title, sized from the available width.
data struct HeroTitle {
    var Width float64
    var Title string
    var Accent string

    func Build() Blob -> Container{
        Padding: Edges{Top: AppTheme.Space24, Bottom: AppTheme.Space16},
        AlignItems: AlignItems.Center,
        Gap: AppTheme.Space12,
        Heading{Content: Title, Size: Math.Clamp(Width * 0.06, 36, 55)}.Build(),
        Text{
            Content: Accent,
            FontFamily: AppTheme.HeadingFont,
            FontWeight: 500,
            FontStyle: FontStyle.Italic,
            FontSize: Math.Clamp(Width * 0.075, 45, 68),
            Color: AppTheme.Current.Accent,
            Margin: Edges{Top: -20}
        },
    }
}
