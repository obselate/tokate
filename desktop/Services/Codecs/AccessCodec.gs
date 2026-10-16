package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class AccessCodec {
    shared {
        func Access(data JsonElement) AccessList {
            let pending = List[AccessRequest]()
            for request in Json.Items(data, "pending") {
                pending.Add(AccessRequest{Donor: Json.Text(request, "donor"), Issue: Json.Text(request, "issue")})
            }
            let members = List[AccessMember]()
            for member in Json.Items(data, "members") {
                members.Add(
                    AccessMember{
                        Donor: Json.Text(member, "donor"),
                        Trusted: Json.Bool(member, "trusted"),
                        Denied: Json.Bool(member, "denied")
                    }
                )
            }
            pending.RemoveAll(request -> members.Exists(member -> member.Denied && String.Equals(member.Donor, request.Donor, StringComparison.OrdinalIgnoreCase)))
            return AccessList{
                Loaded: true,
                AccessSha: Json.Text(data, "access_sha"),
                Pending: pending.ToArray(),
                Members: members.ToArray(),
            }
        }
    }
}
