package TokateDesktop

import Goo
import System

/// A bounded minute stepper with its limit beside the value.
data struct TimeBudget {
    var Caption string
    var Minutes int32
    var Maximum int32
    var Minimum int32
    var Hint string
    var Optional bool
    var Disabled bool
    var Button CommandButton
    var OnChange Action[string]?

    func Build() Blob {
        let change = OnChange
        let less = Optional && Minutes <= Minimum ? "": Math.Max(Minimum, Minutes - 5).ToString()
        let more = Minutes == 0 ? Minimum: Maximum > 0 ? Math.Min(Maximum, Minutes + 5): Minutes + 5
        let budget = Stack{Gap: AppTheme.Space8, Children: []Blob{
            Row{Children: []Blob{
                Container{Width: AppTheme.DetailLabelWidth, FlexShrink: 0, Label{Content: Caption, Size: AppTheme.LabelSize, Muted: true}.Build()},
                Row{NoWrap: true, Children: []Blob{
                    (Button with{Label = "Less " + Caption.ToLowerInvariant(), Icon = "remove", Kind = ButtonKind.Icon, Disabled = Disabled || Minutes == 0 || (!Optional && Minutes <= Minimum), OnClick = () -> change?.Invoke(less)}).Build(),
                    Container{Width: AppTheme.DetailLabelWidth, FlexShrink: 0, AlignItems: AlignItems.Center, Label{Content: Optional && Minutes == 0 ? "Until stopped": DurationText.Format(Minutes), Size: AppTheme.LabelSize}.Build()},
                    (Button with{Label = "More " + Caption.ToLowerInvariant(), Icon = "add", Kind = ButtonKind.Icon, Disabled = Disabled || (Maximum > 0 && Minutes >= Maximum), OnClick = () -> change?.Invoke(more.ToString())}).Build(),
                }}.Build(),
            }}.Build(),
        }}.Build()
        if (Hint ?? "") != "" {
            budget.Children.Add(Container{Padding: Edges{Left: AppTheme.DetailLabelWidth + AppTheme.Space12}, Label{Content: Hint, Muted: true, Size: AppTheme.SmallSize}.Build()})
        }
        return budget
    }
}
