package TokateDesktop

import Goo

/// A caption and value pair in a fixed-width caption column. `Mono` sets the value in the monospace face.
data struct DetailRow {
    var Caption string
    var Value string
    var Mono bool

    func Build() Blob -> Container{
        FlexDirection: FlexDirection.Row,
        AlignItems: AlignItems.FlexStart,
        Gap: 16,
        Container{Width: 120, FlexShrink: 0, Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build()},
        Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Label{Content: Value, Mono: Mono}.Build()},
    }
}
