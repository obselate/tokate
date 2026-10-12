package TokateDesktop

import System

/// Reads what the welcome page shows on top of its choices: the most recent saved contribution and whether
/// the GitHub CLI is signed in. Both reads run in the background, outside the command queue.
class WelcomeService {
    private let window WindowService
    private let changed Action
    private var revision int32

    var Current WelcomeState = WelcomeState{}

    init(window WindowService, changed Action) {
        this.window = window
        this.changed = changed
    }

    /// Reads both again. `remembered` is the run that saved work lists first.
    func Refresh(remembered string) {
        revision++
        go ReadLatest(remembered, revision)
        go ReadSignIn(revision)
    }

    private func ReadLatest(remembered string, expected int32) {
        var latest SavedRun? = nil
        try {
            let paths = RunStore.Discover(remembered)
            if paths.Length > 0 {
                let status = CliClient().Run[Run](TokateCommands.Status(paths[0]), RunCodec.Reader(paths[0]))
                if status.Outcome.Succeeded && status.Value.Readable {
                    latest = SavedRun.Pending(paths[0]) with{Run = status.Value, Changed = RunStore.Changed(paths[0])}
                }
            }
        } catch (error Exception) { }
        Show(expected, state -> state with{Latest = latest})
    }

    private func ReadSignIn(expected int32) {
        let account = GitHubClient().Run[string](GitHubCommands.SignIn(), GitHubCodec.SignIn, 20)
        let state = account.Value ?? ""
        Show(expected, current -> current with{SignedOut = account.Outcome.Succeeded && (state == "none" || state == "error")})
    }

    private func Show(expected int32, apply Func[WelcomeState, WelcomeState]) {
        window.Post(
            () -> {
                if expected == revision {
                    Current = apply(Current)
                    changed()
                }
            }
        )
    }
}
