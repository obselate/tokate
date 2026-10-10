package TokateDesktop

import System
import System.Text.Json

/// Runs Tokate CLI commands with `--json` and decodes their envelopes. Calls block, so run them from a
/// `go` worker. One client runs one command at a time; `Stop` cancels it.
class CliClient {
    private let process ProcessRunner
    let Executable string

    init(executable string = "tokate", lines chan[string]? = nil) {
        Executable = executable
        process = ProcessRunner(lines)
    }

    func Stop() -> process.Stop()

    func RecentOutput() string -> process.RecentOutput()

    /// Runs a command and decodes the envelope's `data` with `decode`.
    func Run[T](arguments []string, decode Func[JsonElement, T], seconds int32 = 120, directory string = "") Reply[T] {
        var value T
        var outcome = CommandOutcome{Diagnostics: "", Failure: "", Report: "", RunPath: ""}
        try {
            let start = CommandStart(Executable, arguments, directory)
            start.ArgumentList.Add("--json")
            let result = process.Run(start, seconds)
            outcome = outcome with{ExitCode = result.ExitCode, Diagnostics = result.Diagnostics, Failure = result.Error}
            if result.Error == "" {
                let root = Json.Parse(result.Output)
                let envelope = CliCodec.Envelope(root)
                if !CliCodec.Matches(envelope, result.ExitCode, arguments[0]) {
                    outcome = outcome with{
                        Failure = "The CLI returned an unsupported result. Inspect state before repeating this action."
                    }
                } else {
                    outcome = outcome with{
                        Envelope = envelope,
                        Report = CliCodec.Report(root),
                        RunPath = CliCodec.RunPath(root),
                    }
                    value = decode(Json.Get(root, "data"))
                }
            }
        } catch (error Exception) {
            outcome = outcome with{Failure = error.Message}
        }
        return Reply[T]{Outcome: outcome, Value: value}
    }

    /// Runs a command whose data is not needed.
    func Run(arguments []string, seconds int32 = 120, directory string = "") CommandOutcome ->
    Run[bool](arguments, data -> true, seconds, directory).Outcome
}
