package TokateDesktop

import System
import System.IO

/// Reads Codex's bundled model catalog in an empty, throwaway home so no donor settings are read.
/// Calls block, so run them from a `go` worker.
class CodexCatalog : Cancellable {
    private let process ProcessRunner = ProcessRunner()

    func Stop() -> process.Stop()

    func RecentOutput() string -> process.RecentOutput()

    func Load(seconds int32 = 120) Reply[[]ModelChoice] {
        var models = []ModelChoice{}
        var outcome = CommandOutcome{Diagnostics: "", Failure: "", Report: "", RunPath: ""}
        try {
            let start = CommandStart("codex", CodexCommands.BundledModels())
            for path in(Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator) {
                let candidate = Path.Combine(path, "codex")
                if Path.IsPathFullyQualified(candidate) && File.Exists(candidate) {
                    start.FileName = candidate
                    break
                }
            }
            if !Path.IsPathFullyQualified(start.FileName) {
                throw Exception("Install Codex to load its model catalog.")
            }
            let directory = Path.Combine(Path.GetTempPath(), "tokate-models-" + Guid.NewGuid().ToString("N"))
            Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            try {
                start.Environment.Clear()
                start.Environment["PATH"] = "/usr/local/bin:/usr/bin:/bin"
                start.Environment["HOME"] = directory
                start.Environment["CODEX_HOME"] = directory
                start.WorkingDirectory = directory
                let result = process.Run(start, seconds)
                outcome = outcome with{ExitCode = result.ExitCode, Diagnostics = result.Diagnostics, Failure = result.Error}
                if result.Error == "" {
                    models = DonorCodec.CodexModels(Json.Parse(result.Output))
                }
            } finally {
                Directory.Delete(directory, true)
            }
        } catch (error Exception) {
            outcome = outcome with{Failure = error.Message}
        }
        return Reply[[]ModelChoice]{Outcome: outcome, Value: models}
    }
}
