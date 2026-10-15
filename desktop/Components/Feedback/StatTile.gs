package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// A highlighted value with an icon and caption.
data struct StatTile {
    var Title string
    var Value string
    var Icon string

    func Build() Blob -> Container{
        FlexGrow: 1,
        FlexBasis: 0,
        MinWidth: AppTheme.ShortFieldWidth,
        Padding: AppTheme.Space24,
        Gap: AppTheme.Space8,
        BackgroundColor: AppTheme.Current.Surface,
        BorderRadius: AppTheme.ControlRadius,
        BorderWidth: 1,
        BorderColor: AppTheme.Current.Line,
        Heading{Content: Value}.Build(),
        Row{
            Gap: AppTheme.Space8,
            Children: (Icon ?? "") == "" ? []Blob{
                Label{Content: Title, Size: AppTheme.SmallSize, Muted: true}.Build(),
            }: []Blob{
                MaterialIcons.Create(Icon, 18, AppTheme.Current.Accent),
                Label{Content: Title, Size: AppTheme.SmallSize, Muted: true}.Build(),
            },
        }.Build(),
    }
}
