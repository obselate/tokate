package TokateDesktop

import Goo

/// A caption and value pair in a fixed-width caption column.
data struct DetailRow {
    var Caption string
    var Value string

    func Build() Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.FlexStart,
        Gap: 16,
        Container{Width: 120, FlexShrink: 0, Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build()},
        Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Label{Content: Value}.Build()},
    }
}
