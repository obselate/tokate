package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System

/// Named steps in order. The steps before `Current` are done and the step at `Current` shows `State`.
/// `Narrow` names only the current step.
data struct Progression {
    var Names []string
    var Current int32
    var State Tone
    var Narrow bool

    func Build() Blob {
        let p = AppTheme.Current
        let row = Row{
            Children: []Blob{},
            Gap: AppTheme.Space8,
            Name: Current < Names.Length ? "Step " + (Current + 1).ToString() + " of " + Names.Length.ToString() + ": " + Names[
                Current
            ]: "All steps done",
        }.Build()
        for index in 0 ... Names.Length {
            if index > 0 {
                row.Children.Add(Container{FlexGrow: 1, MinWidth: AppTheme.Space12, Height: 1, BackgroundColor: p.Line})
            }
            let now = index == Current
            let ink = index < Current ? p.Ok: now ? AppTheme.Look(State).Edge: p.Muted
            let icon = index < Current ? "check_circle": !now ? "radio_button_unchecked": State == Tone.Fail ? "error": "radio_button_checked"
            let step = Row{Gap: AppTheme.Space8, NoWrap: true, Children: []Blob{MaterialIcons.Create(icon, 18, ink)}}.Build()
            if now || !Narrow {
                step.Children.Add(Label{Content: Names[index], Size: AppTheme.SmallSize, Ink: now ? p.Ink: ink}.Build())
            }
            row.Children.Add(step)
        }
        return row
    }
}
