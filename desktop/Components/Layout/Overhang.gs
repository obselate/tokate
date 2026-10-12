package TokateDesktop

import Goo

/// Content with an optional blob that floats centered in the gap above it. `Above` takes no layout space, so
/// the content and everything around it stay where they are.
data struct Overhang {
    var Content Blob
    var Above Blob?

    func Build() Blob -> Container{
        Position: PositionType.Relative,
        Content,
        Container{
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Bottom: Percent(100),
            Padding: Edges{Bottom: 4},
            AlignItems: AlignItems.Center,
            Children: Above != nil ? []Blob{Above!!}: []Blob{},
        },
    }
}
