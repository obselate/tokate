package TokateDesktop

import Goo

/// A page title above a caption and links, with an optional blob at the end of the title line.
/// `Stacked` puts that blob below the title.
data struct PageTitle {
    var Title string
    var Caption string
    var Links []Blob
    var Trailing Blob?
    var Stacked bool

    func Build() Container {
        let links = Row{Children: []Blob{}, Gap: 4}.Build()
        if (Caption ?? "") != "" {
            links.Children.Add(Label{Content: Caption, Size: AppTheme.SmallSize, Muted: true}.Build())
        }
        for link in Links ?? []Blob{} {
            links.Children.Add(link)
        }
        let copy = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            Gap: 2,
            Heading{Content: Title, Size: AppTheme.DisplaySize, MaxLines: 2}.Build(),
        }
        let title = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.FlexStart, Gap: 16, copy}
        if let trailing = Trailing {
            if Stacked {
                copy.Children.Add(Container{AlignItems: AlignItems.FlexStart, Padding: Edges{Top: 6, Bottom: 6}, trailing})
            } else {
                title.Children.Add(Container{Padding: Edges{Top: 8}, FlexShrink: 0, trailing})
            }
        }
        copy.Children.Add(links)
        return title
    }
}
