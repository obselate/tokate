package TokateDesktop

import System

/// The confirmation awaiting an answer, if any.
class DialogService {
    private let changed Action
    private var action Action?
    var Current Confirmation?

    init(changed Action) {
        this.changed = changed
    }

    prop Open bool -> Current != nil

    func Ask(confirmation Confirmation, onConfirm Action) {
        Current = confirmation
        action = onConfirm
        changed()
    }

    func Confirm() {
        let confirmed = action
        Current = nil
        action = nil
        confirmed?.Invoke()
        changed()
    }

    func Dismiss() {
        Current = nil
        action = nil
        changed()
    }
}
