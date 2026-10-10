package TokateDesktop

import System

/// The current destination.
class NavigationService {
    private let changed Action
    var Current Destination = Destination.Welcome

    init(changed Action) {
        this.changed = changed
    }

    func Go(next Destination) {
        Current = next
        changed()
    }
}
