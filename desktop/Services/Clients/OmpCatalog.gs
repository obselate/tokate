package TokateDesktop

import System
import System.IO

/// Reads the models that the donor's OMP lists. Calls block, so run them from a `go` worker.
class OmpCatalog : Cancellable {
    private let process ProcessRunner = ProcessRunner()

    func Stop() -> process.Stop()

    func RecentOutput() string -> process.RecentOutput()

    func Load(seconds int32 = 60) Reply[[]ModelChoice] {
        var models = []ModelChoice{}
        var outcome = CommandOutcome{Diagnostics: "", Failure: "", Report: "", RunPath: ""}
        try {
            let result = process.Run(CommandStart("omp", OmpCommands.Models()), seconds)
            outcome = outcome with{ExitCode = result.ExitCode, Diagnostics = result.Diagnostics, Failure = result.Error}
            if result.Error == "" {
                models = DonorCodec.OmpModels(Json.Parse(result.Output))
            }
        } catch (error Exception) {
            outcome = outcome with{Failure = "Install OMP and sign in to load its models."}
        }
        return Reply[[]ModelChoice]{Outcome: outcome, Value: models}
    }
}
