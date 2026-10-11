package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// Named steps in order. The steps before `Current` are done and the step at `Current` shows `State`.
data struct Progression {
    var Names []string
    var Current int32
    var State Tone

    func Build() Blob {
        let p = AppTheme.Current
        let row = Row{
            Children: []Blob{},
            Gap: 8,
            Name: Current < Names.Length ? "Step " + (Current + 1).ToString() + " of " + Names.Length.ToString() + ": " + Names[
                Current
            ]: "All steps done",
        }.Build()
        for index in 0 ... Names.Length {
            if index > 0 {
                row.Children.Add(Container{FlexGrow: 1, MinWidth: 12, Height: 1, BackgroundColor: p.Line})
            }
            let now = index == Current
            let ink = index < Current ? p.Ok: now ? AppTheme.Look(State).Edge: p.Muted
            let icon = index < Current ? "check_circle": !now ? "radio_button_unchecked": State == Tone.Fail ? "error": "radio_button_checked"
            row.Children.Add(
                Row{
                    Gap: 6,
                    NoWrap: true,
                    Children: []Blob{
                        MaterialIcons.Create(icon, 18, ink),
                        Label{Content: Names[index], Size: AppTheme.SmallSize, Ink: now ? p.Ink: ink}.Build(),
                    },
                }.Build()
            )
        }
        return row
    }
}
