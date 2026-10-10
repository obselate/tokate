package TokateDesktop

import Goo

/// Cards side by side at equal height, or stacked at full width when `Stacked`.
data struct CardColumns {
    var Cards []Container
    var Stacked bool

    func Build() Container {
        let columns = Row{Children: []Blob{}, Align: AlignItems.Stretch, NoWrap: true}.Build()
        columns.FlexDirection = Stacked ? FlexDirection.Column: FlexDirection.Row
        for i in 0 ... Cards.Length {
            let card = Cards[i]
            card.FlexGrow = Stacked ? 0: 1
            card.FlexBasis = Stacked ? Length.Auto: Length(0)
            card.Width = Stacked ? Percent(100): Length.Auto
            card.MinWidth = Stacked ? 0: 350
            columns.Children.Add(card)
        }
        return columns
    }
}
