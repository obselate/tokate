package TokateDesktop

import Goo
import Goo.Widgets.Icons
import System
import System.Collections.Generic

/// A reserved donation before it starts: its state, budget, and the Start control once approved.
data struct DonationStatus {
    var Progress DonationProgress
    var Message string
    var Button CommandButton
    var Busy bool
    var Cancellable bool
    var Compact bool
    var OnStart Action?
    var OnInspectSaved Action?

    func Build() Blob {
        let run = Progress.Run
        let children = List[Blob]{
            Row{
                Children: []Blob{
                    MaterialIcons.Create(Progress.Ready ? "task_alt": "hourglass_top", 32, AppTheme.Current.Accent),
                    Heading{Content: Progress.State, Size: 32}.Build(),
                },
            }.Build(),
        }
        if Progress.Path != "" {
            children.Add(
                Row{
                    Children: []Blob{
                        SummaryTile{Title: "Coding", Value: run.CodingTime, Icon: "schedule"}.Build(),
                        SummaryTile{Title: "Verification", Value: run.VerificationTime, Icon: "verified"}.Build(),
                    },
                }.Build()
            )
            children.Add(DetailRow{Caption: "Model", Value: run.Model + " / " + run.Effort}.Build())
        }
        if Message != "" {
            children.Add(Label{Content: Message, Size: 17, Muted: true}.Build())
        }
        children.Add(
            Row{
                Children: []Blob{
                    (Button with{Label = "Start donation", OnClick = OnStart, Primary = true, Disabled = !Progress.Ready}).Build(),
                },
            }.Build()
        )
        if Cancellable {
            children.Add(Row{Children: []Blob{CancelButton{Stopping: Button.Stopping, OnCancel: Button.OnCancel}.Build()}}.Build())
        }
        if !Busy && Progress.Path == "" {
            children.Add(
                Row{Children: []Blob{(Button with{Label = "Inspect saved work", OnClick = OnInspectSaved}).Build()}}.Build()
            )
        }
        return Panel{Compact: Compact, Children: children.ToArray()}.Build()
    }
}
