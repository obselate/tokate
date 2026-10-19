package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The pending requests for issue access, one line for each, with the owner's approve and trust actions.
data struct AccessRequests {
    var Requests []AccessRequest
    var CanWrite bool
    var Button CommandButton
    var OnApprove Action[AccessRequest]?
    var OnTrust Action[AccessRequest]?

    func Build() Blob {
        let approve = OnApprove
        let trust = OnTrust
        let lines = List[Blob]()
        for request in Requests {
            let selected = request
            lines.Add(
                ListRow{
                    Children: []Blob{
                        Label{Content: request.Donor}.Build(),
                        Label{Content: "Requests issue #" + request.Issue, Size: AppTheme.SmallSize, Muted: true}.Build(),
                        Spacer{}.Build(),
                        (Button with{
                            Label = "Approve #" + request.Issue,
                            Name = "Approve #" + request.Issue + " for " + request.Donor,
                            Tone = ButtonTone.Positive,
                            OnClick = () -> approve?.Invoke(selected),
                            Disabled = !CanWrite,
                        }).Build(),
                        (Button with{
                            Label = "Trust for all issues",
                            Name = "Trust " + request.Donor,
                            Tone = ButtonTone.Positive,
                            OnClick = () -> trust?.Invoke(selected),
                            Disabled = !CanWrite,
                        }).Build(),
                    },
                }.Build()
            )
        }
        if Requests.Length == 0 {
            lines.Add(ListRow{Children: []Blob{Label{Content: "No pending requests", Muted: true}.Build()}}.Build())
        }
        return ListSection{Title: "Requests", Count: Requests.Length, Children: lines.ToArray()}.Build()
    }
}
