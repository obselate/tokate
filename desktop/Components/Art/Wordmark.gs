package TokateDesktop

import Goo

/// The sprig mark and "tokate" name at the top of the navigation rail.
data struct Wordmark {
    var Mark Blob
    var Narrow bool

    func Build() Blob -> Container{
        FlexDirection: FlexDirection.Row,
        Gap: 10,
        AlignItems: AlignItems.Center,
        JustifyContent: JustifyContent.Center,
        Padding: Edges{Bottom: 16},
        Container{Width: 25, Height: 36, Mark},
        Text{
            Content: "tokate",
            FontFamily: AppTheme.BodyFont,
            FontSize: Narrow ? 34: 38,
            Color: AppTheme.Current.Accent,
        },
    }
}
