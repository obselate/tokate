package TokateDesktop

import Goo

/// Equal-width columns that stack vertically when space is short. Zero gap resolves to 18.
data struct Columns {
    var Children []Blob
    var Gap float64
    var Stacked bool
    var MinWidth float64

    func Build() Container {
        let columns = Container{
            FlexDirection: Stacked ? FlexDirection.Column: FlexDirection.Row,
            AlignItems: Stacked ? AlignItems.Stretch: AlignItems.FlexStart,
            Gap: Gap == 0 ? 18: Gap,
        }
        for child in Children ?? []Blob{} {
            if Stacked {
                columns.Children.Add(child)
            } else {
                columns.Children.Add(Container{FlexGrow: 1, FlexBasis: 0, MinWidth: MinWidth, child})
            }
        }
        return columns
    }
}
