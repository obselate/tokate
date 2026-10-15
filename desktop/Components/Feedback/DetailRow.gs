package TokateDesktop

import Goo

/// A caption and value pair in a fixed-width caption column. `Mono` sets the value in the monospace face.
data struct DetailRow {
    var Caption string
    var Value string
    var Mono bool
    var Children []Blob

    func Build() Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.FlexStart,
        Gap: AppTheme.Space16,
        Container{Width: AppTheme.DetailLabelWidth, FlexShrink: 0, Label{Content: Caption, Size: AppTheme.LabelSize, Muted: true}.Build()},
        Container{
            FlexGrow: 1, FlexBasis: 0, MinWidth: 0,
            Children: Children.Length == 0 ? []Blob{Label{Content: Value, Mono: Mono}.Build()}: []Blob{Row{Gap: AppTheme.Space8, Children: Children}.Build()},
        },
    }
}
