package TokateDesktop

import Goo

/// A wrapping horizontal group. Nil gap resolves to 12 and nil alignment to centered items.
data struct Row {
    var Children []Blob
    var Gap float64?
    var Align AlignItems?
    var Justify JustifyContent?
    var NoWrap bool
    var Name string?

    func Build() Container {
        let row = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: Align ?? AlignItems.Center,
            Gap: Gap ?? AppTheme.Space12,
            FlexWrap: NoWrap ? FlexWrap.NoWrap: FlexWrap.Wrap,
            Children: Children ?? []Blob{},
        }
        if let justify = Justify {
            row.JustifyContent = justify
        }
        if let name = Name {
            row.Accessibility = Accessibility{Role: AccessibilityRole.Status, Name: name}
        }
        return row
    }
}
