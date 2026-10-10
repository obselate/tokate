package TokateDesktop

import Goo

/// Artwork above a centered content column. The artwork fills the remaining height unless the window is short.
data struct Showcase {
    var Art Blob
    var Children []Blob
    var Short bool

    func Build() Blob -> Container{
        Height: Short ? Length.Auto: Percent(100),
        MinHeight: 0,
        Gap: 0,
        Art,
        Container{
            Width: Percent(100),
            MaxWidth: 1050,
            AlignSelf: AlignSelf.Center,
            Padding: Edges{Left: 24, Right: 24, Bottom: 32},
            Gap: 24,
            Children: Children ?? []Blob{},
        },
    }
}
