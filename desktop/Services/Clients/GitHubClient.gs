package TokateDesktop

import System
import System.Text.Json

/// Runs GitHub CLI commands that print JSON and decodes the whole result. Calls block, so run them from
/// a `go` worker.
class GitHubClient {
    private let process ProcessRunner = ProcessRunner()
    let Executable string

    init(executable string = "gh") {
        Executable = executable
    }

    func Stop() -> process.Stop()

    func Run[T](arguments []string, decode Func[JsonElement, T], seconds int32 = 120) Reply[T] {
        var value T
        var outcome = CommandOutcome{Diagnostics: "", Failure: "", Report: "", RunPath: ""}
        try {
            let result = process.Run(CommandStart(Executable, arguments), seconds)
            outcome = outcome with{ExitCode = result.ExitCode, Diagnostics = result.Diagnostics, Failure = result.Error}
            if result.Error == "" {
                value = decode(Json.Parse(result.Output))
            }
        } catch (error Exception) {
            outcome = outcome with{Failure = error.Message}
        }
        return Reply[T]{Outcome: outcome, Value: value}
    }
}
