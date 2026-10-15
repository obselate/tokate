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
        return Row{NoWrap: true, Align: AlignItems.FlexStart, Children: []Blob{
            Container{Width: AppTheme.DetailLabelWidth, FlexShrink: 0, Height: AppTheme.ButtonHeight, JustifyContent: JustifyContent.Center, Label{Content: Caption, Size: AppTheme.LabelSize, Muted: true}.Build()},
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Stack{Gap: AppTheme.Space8, Children: []Blob{
                Optional ? Container{Height: AppTheme.ButtonHeight, JustifyContent: JustifyContent.Center, Check{Label: "Until stopped", Value: Minutes == 0, Disabled: Disabled, OnChange: value -> change?.Invoke(value ? "": "60")}.Build()}: Container{},
                Optional && Minutes == 0 ? Container{}: Row{Children: []Blob{
                    Row{NoWrap: true, Children: []Blob{
                        (Button with{Label = "Less " + Caption.ToLowerInvariant(), Icon = "remove", Kind = ButtonKind.Icon, Disabled = Disabled || Minutes <= Minimum, OnClick = () -> change?.Invoke(Math.Max(Minimum, Minutes - 5).ToString())}).Build(),
                        Container{Width: AppTheme.QuietMinWidth, FlexShrink: 0, AlignItems: AlignItems.Center, Label{Content: Minutes.ToString() + " min", Size: AppTheme.LabelSize}.Build()},
                        (Button with{Label = "More " + Caption.ToLowerInvariant(), Icon = "add", Kind = ButtonKind.Icon, Disabled = Disabled || (Maximum > 0 && Minutes >= Maximum), OnClick = () -> change?.Invoke((Maximum > 0 ? Math.Min(Maximum, Minutes + 5): Minutes + 5).ToString())}).Build(),
                    }}.Build(),
                    Label{Content: Hint, Muted: true, Size: AppTheme.SmallSize}.Build(),
                }}.Build(),
            }}.Build()},
        }}.Build()
    }
}
