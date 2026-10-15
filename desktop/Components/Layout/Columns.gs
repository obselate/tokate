package TokateDesktop

import Goo

/// Equal-width columns that stack vertically when space is short.
data struct Columns {
    var Children []Blob
    var Gap float64
    var Stacked bool

    func Build() Container {
        let columns = Container{
            FlexDirection: Stacked ? FlexDirection.Column: FlexDirection.Row,
            AlignItems: Stacked ? AlignItems.Stretch: AlignItems.FlexStart,
            Gap: Gap == 0 ? AppTheme.ColumnGap: Gap,
        }
        for child in Children ?? []Blob{} {
            if Stacked {
                columns.Children.Add(child)
            } else {
                columns.Children.Add(Container{FlexGrow: 1, FlexBasis: 0, MinWidth: AppTheme.ColumnMin, child})
            }
        }
        return columns
    }
}
