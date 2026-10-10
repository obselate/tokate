package TokateDesktop

import System

/// The message and report about the latest action.
class FeedbackService {
    private let changed Action
    var Current Feedback = Feedback{Message: "", Report: ""}

    init(changed Action) {
        this.changed = changed
    }

    func Show(message string) -> Set(Current with{Message = message})

    func ShowReport(report string) -> Set(Current with{Report = report})

    func Clear() -> Set(Feedback{Message: "", Report: ""})

    /// The message after a command finishes: its failure, a pending notice, or an attention notice.
    func ShowOutcome(outcome CommandOutcome) -> Show(
        outcome.Failure != "" ? outcome.Failure: outcome.Pending ?
        "Pending. Another person or the coordinator needs to act.": outcome.ExitCode != 0 ?
        "This action needs attention.": ""
    )

    /// Shows why a finished command failed and clears the report.
    func ShowError(outcome CommandOutcome) -> Set(Feedback{Message: outcome.ErrorMessage(), Report: ""})

    private func Set(next Feedback) {
        if next != Current {
            Current = next
            changed()
        }
    }
}
