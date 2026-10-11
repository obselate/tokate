package TokateDesktop

import Goo
import System

/// A donor's pending request for access to one issue.
data struct AccessRequestCard {
    var Request AccessRequest
    var CanWrite bool
    var Compact bool
    var Button CommandButton
    var OnGrant Action?
    var OnTrust Action?

    func Build() Blob -> Panel{
        Compact: Compact,
        Children: []Blob{
            Row{
                Children: []Blob{
                    Heading{Content: Request.Donor}.Build(),
                    StatusBadge{Value: "Access requested", Tone: Tone.Need}.Build(),
                    Label{Content: "#" + Request.Issue}.Build(),
                },
            }.Build(),
            Row{
                Children: []Blob{
                    (Button with{
                        Label = "Grant #" + Request.Issue + " to " + Request.Donor,
                        OnClick = OnGrant,
                        Primary = true,
                        Disabled = !CanWrite,
                    }).Build(),
                    (Button with{Label = "Trust " + Request.Donor, OnClick = OnTrust, Disabled = !CanWrite}).Build(),
                },
            }.Build(),
        },
    }.Build()
}

/// A donor with project access and the owner's trust and deny controls.
data struct AccessMemberCard {
    var Member AccessMember
    var CanWrite bool
    var Compact bool
    var Button CommandButton
    var OnTrust Action?
    var OnDeny Action?

    func Build() Blob -> Panel{
        Compact: Compact,
        Children: []Blob{
            Row{
                Children: []Blob{
                    Heading{Content: Member.Donor}.Build(),
                    StatusBadge{Value: Member.Badge, Tone: Statuses.ToneOf(Member.Badge)}.Build(),
                },
            }.Build(),
            Row{
                Children: []Blob{
                    (Button with{
                        Label = (Member.Trusted ? "Untrust ": "Trust ") + Member.Donor,
                        OnClick = OnTrust,
                        Disabled = !CanWrite,
                    }).Build(),
                    (Button with{
                        Label = (Member.Denied ? "Restore ": "Deny ") + Member.Donor,
                        OnClick = OnDeny,
                        Disabled = !CanWrite,
                    }).Build(),
                },
            }.Build(),
        },
    }.Build()
}
