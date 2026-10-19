package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Donor access: pending requests, then the donors with access.
class AccessTab {
    private let owner OwnerService

    init(owner OwnerService) {
        this.owner = owner
    }

    func Build(page PageContext) Blob {
        let state = owner.Current
        let canWrite = state.Project.CanWrite
        let body = List[Blob]()
        if !state.Access.Loaded {
            return Panel{Children: []Blob{
                page.Busy && page.Loader != nil ? page.Loader!!("Reading donor access"): EmptyMessage{Content: "Access could not be loaded. Refresh to try again.", Icon: "group"}.Build(),
            }}.Build()
        }
        if state.Access.Loaded {
            body.Add(
                AccessRequests{
                    Requests: state.Access.Pending,
                    CanWrite: canWrite,
                    Button: page.Button,
                    OnApprove: request -> owner.ApproveAccess(request.Donor, request.Issue),
                    OnTrust: request -> owner.ChangeAccess("trust", request.Donor),
                }.Build()
            )
        }
        body.Add(
            DonorList.Mount(
                DonorListInput{
                    Owner: owner,
                    Members: state.Access.Members,
                    CanWrite: canWrite,
                    Busy: page.Busy,
                    Button: page.Button,
                }
            )
        )
        return Stack{Gap: AppTheme.SectionGap, Children: body.ToArray()}.Build()
    }
}
