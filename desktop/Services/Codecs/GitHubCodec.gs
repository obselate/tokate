package TokateDesktop

import System
import System.Text.Json

class GitHubCodec {
    shared {
        func Login(user JsonElement) string -> Json.Text(user, "login")

        func Project(repository string, value JsonElement) ProjectInfo -> ProjectInfo{
            Repository: repository,
            CanWrite: Json.Bool(Json.Get(value, "permissions"), "push"),
            Branch: Json.Text(value, "default_branch"),
        }
    }
}
