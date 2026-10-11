package TokateDesktop

import System
import System.Collections.Generic
import System.Text.Json

class GitHubCodec {
    shared {
        func Login(user JsonElement) string -> Json.Text(user, "login")

        /// The sign-in state of the active github.com account: "success", "timeout" or "error", or "none" when
        /// no account is signed in. Empty when the report has another shape.
        func SignIn(status JsonElement) string {
            let hosts = Json.Get(status, "hosts")
            if !Json.IsObject(hosts) {
                return ""
            }
            for account in Json.Items(hosts, "github.com") {
                if Json.Bool(account, "active") {
                    return Json.Text(account, "state")
                }
            }
            return "none"
        }

        /// The repositories that are not archived and that the user can push to.
        func Projects(value JsonElement) []ProjectChoice {
            let projects = List[ProjectChoice]()
            for item in Json.Items(value) {
                if Json.Bool(Json.Get(item, "permissions"), "push") && !Json.Bool(item, "archived") {
                    projects.Add(ProjectChoice{Repository: Json.Text(item, "full_name"), Description: Json.Text(item, "description")})
                }
            }
            return projects.ToArray()
        }

        func Project(repository string, value JsonElement) ProjectInfo -> ProjectInfo{
            Repository: repository,
            CanWrite: Json.Bool(Json.Get(value, "permissions"), "push"),
            Branch: Json.Text(value, "default_branch"),
        }
    }
}
