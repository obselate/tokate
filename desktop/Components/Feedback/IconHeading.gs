package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A heading preceded by an accent icon. Zero sizes resolve to a 28 heading and 25 icon.
data struct IconHeading {
    var Icon string
    var Content string
    var Size float64
    var IconSize float64

    func Build() Container -> Row{
        Children: []Blob{
            MaterialIcons.Create(Icon, IconSize == 0 ? 25: IconSize, AppTheme.Current.Accent),
            Heading{Content: Content, Size: Size == 0 ? 28: Size}.Build(),
        },
    }.Build()
}
