package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// The heading of a section: an accent icon, the title, and an optional line of detail below. Zero sizes
/// resolve to a 28 heading and 25 icon.
data struct IconHeading {
    var Icon string
    var Content string
    var Detail string
    var Size float64
    var IconSize float64

    func Build() Container {
        let title = Row{
            Children: []Blob{
                MaterialIcons.Create(Icon, IconSize == 0 ? 25: IconSize, AppTheme.Current.Accent),
                Heading{Content: Content, Size: Size == 0 ? 28: Size}.Build(),
            },
        }.Build()
        if (Detail ?? "") == "" {
            return title
        }
        return Stack{Gap: 6, Children: []Blob{title, Label{Content: Detail, Size: AppTheme.SmallSize, Muted: true}.Build()}}.Build()
    }
}
