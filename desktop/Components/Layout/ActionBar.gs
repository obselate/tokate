package TokateDesktop

import Goo

/// Step actions in secondary then primary order, at the end of the content column.
data struct ActionBar {
    var Children []Blob

    func Build() Container -> Row{
        Justify: JustifyContent.FlexEnd,
        Children: Children,
    }.Build()
}
