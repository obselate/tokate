package TokateDesktop

import Goo

/// Artwork above a centered content column. The artwork fills the remaining height unless the window is short.
/// `Overlay` floats centered over the top of the artwork and takes no layout space.
data struct Showcase {
    var Art Blob
    var Children []Blob
    var Overlay Blob?
    var Short bool

    func Build() Blob -> Container{
        Position: PositionType.Relative,
        Height: Short ? Length.Auto: Percent(100),
        MinHeight: 0,
        Gap: 0,
        Art,
        Container{
            Width: Percent(100),
            MaxWidth: AppTheme.ContentMax + AppTheme.PageGutter * 2,
            AlignSelf: AlignSelf.Center,
            Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space24, Bottom: AppTheme.Space32},
            Gap: AppTheme.Space24,
            Children: Children ?? []Blob{},
        },
        Container{
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Top: AppTheme.Space24,
            Padding: Edges{Left: AppTheme.Space24, Right: AppTheme.Space24},
            AlignItems: AlignItems.Center,
            Children: Overlay != nil ? []Blob{Overlay!!}: []Blob{},
        },
    }
}
