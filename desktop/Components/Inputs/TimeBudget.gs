package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Minute presets and a bounded stepper.
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
        let values = []int32{15, 30, 60, 120, 180}
        let labels = List[string]()
        let unavailable = List[bool]()
        var selected int32 = -1
        for i in 0 ... values.Length {
            let value = values[i]
            labels.Add(value >= 60 ? (value / 60).ToString() + " h": value.ToString() + " min")
            unavailable.Add(Disabled || value < Minimum || (Maximum > 0 && value > Maximum))
            if Minutes == value { selected = i }
        }
        return Stack{Gap: AppTheme.Space8, Children: []Blob{
            Label{Content: Caption, Size: AppTheme.LabelSize, Muted: true}.Build(),
            Label{Content: Hint, Muted: true, Size: AppTheme.SmallSize}.Build(),
            PresetGroup{Button: Button, Labels: labels.ToArray(), Unavailable: unavailable.ToArray(), Selected: selected, OnChoose: index -> change?.Invoke(values[index].ToString())}.Build(),
            Row{Children: []Blob{
                (Button with{Label = "Less " + Caption.ToLowerInvariant(), Icon = "remove", Kind = ButtonKind.Icon, Disabled = Disabled || Minutes <= Minimum, OnClick = () -> change?.Invoke(Math.Max(Minimum, Minutes - 5).ToString())}).Build(),
                Label{Content: Minutes == 0 ? "Until stopped": Minutes.ToString() + " min"}.Build(),
                (Button with{Label = "More " + Caption.ToLowerInvariant(), Icon = "add", Kind = ButtonKind.Icon, Disabled = Disabled || (Maximum > 0 && Minutes >= Maximum), OnClick = () -> change?.Invoke((Maximum > 0 ? Math.Min(Maximum, Minutes + 5): Minutes + 5).ToString())}).Build(),
            }}.Build(),
            Optional ? Check{Label: "Until stopped", Value: Minutes == 0, Disabled: Disabled, OnChange: value -> change?.Invoke(value ? "": "60")}.Build(): Container{},
        }}.Build()
    }
}
