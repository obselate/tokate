package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// The pending requests for issue access, one line for each, with the owner's grant and trust actions.
data struct AccessRequests {
    var Requests []AccessRequest
    var CanWrite bool
    var Button CommandButton
    var OnGrant Action[AccessRequest]?
    var OnTrust Action[AccessRequest]?

    func Build() Blob {
        let grant = OnGrant
        let trust = OnTrust
        let lines = List[Blob]()
        for request in Requests {
            let selected = request
            lines.Add(
                ListRow{
                    Children: []Blob{
                        Container{Width: AppTheme.ShortFieldWidth, FlexShrink: 0, Label{Content: request.Donor}.Build()},
                        Label{Content: "Requests issue #" + request.Issue, Size: AppTheme.SmallSize, Muted: true}.Build(),
                        Spacer{}.Build(),
                        (Button with{
                            Label = "Grant #" + request.Issue,
                            Name = "Grant #" + request.Issue + " to " + request.Donor,
                            OnClick = () -> grant?.Invoke(selected),
                            Disabled = !CanWrite,
                        }).Build(),
                        (Button with{
                            Label = "Trust for all issues",
                            Name = "Trust " + request.Donor,
                            Kind = ButtonKind.Quiet,
                            OnClick = () -> trust?.Invoke(selected),
                            Disabled = !CanWrite,
                        }).Build(),
                    },
                }.Build()
            )
        }
        return SectionPanel{Title: "Requests", Count: Requests.Length, Children: lines.ToArray()}.Build()
    }
}
