package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Donor access: pending requests, current members, and direct grants.
class AccessTab {
    private let owner OwnerService

    init(owner OwnerService) {
        this.owner = owner
    }

    func Build(page PageContext) Blob {
        let state = owner.Current
        let canWrite = state.Project.CanWrite
        let body = List[Blob]{
            Row{
                Children: []Blob{
                    (page.Button with{Label = "Refresh access", OnClick = () -> owner.LoadAccess()}).Build(),
                    (page.Button with{
                        Label = "Initialize access",
                        OnClick = () -> owner.ChangeAccess("init", ""),
                        Disabled = !canWrite || state.Access.AccessSha != "",
                    }).Build(),
                },
            }.Build(),
        }
        for request in state.Access.Pending {
            let donor = request.Donor
            let issue = request.Issue
            body.Add(
                AccessRequestCard{
                    Request: request,
                    CanWrite: canWrite,
                    Compact: page.CompactPanels,
                    Button: page.Button,
                    OnGrant: () -> owner.ChangeAccess("grant", donor, issue),
                    OnTrust: () -> owner.ChangeAccess("trust", donor),
                }.Build()
            )
        }
        for member in state.Access.Members {
            let donor = member.Donor
            let trust = member.Trusted ? "untrust": "trust"
            let deny = member.Denied ? "restore": "deny"
            body.Add(
                AccessMemberCard{
                    Member: member,
                    CanWrite: canWrite,
                    Compact: page.CompactPanels,
                    Button: page.Button,
                    OnTrust: () -> owner.ChangeAccess(trust, donor),
                    OnDeny: () -> owner.ChangeAccess(deny, donor),
                }.Build()
            )
        }
        body.Add(
            GrantAccessForm.Mount(
                GrantAccessInput{
                    Owner: owner,
                    CanWrite: canWrite,
                    Busy: page.Busy,
                    Compact: page.CompactPanels,
                    Button: page.Button,
                }
            )
        )
        return Stack{Gap: 18, Children: body.ToArray()}.Build()
    }
}
