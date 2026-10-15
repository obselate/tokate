package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A highlighted value with an icon and caption.
data struct SummaryTile {
    var Title string
    var Value string
    var Icon string

    func Build() Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: AppTheme.ShortFieldWidth,
        Padding: AppTheme.Space24,
        Gap: AppTheme.Space12,
        BackgroundColor: AppTheme.Current.Paper,
        BorderRadius: AppTheme.ControlRadius,
        Row{
            Children: []Blob{
                MaterialIcons.Create(Icon, 22, AppTheme.Current.Accent),
                Label{Content: Title, Size: AppTheme.SmallSize, Muted: true}.Build(),
            },
        }.Build(),
        Heading{Content: Value}.Build(),
    }
}
