package TokateDesktop

import System

class UiDispatcher {
    private let post Func[Action, bool]

    init(post Func[Action, bool]) {
        this.post = post
    }

    func TryPost(action Action) bool -> post(action)

    shared {
        func Inline() UiDispatcher -> UiDispatcher(
            action -> {
                action()
                return true
            }
        )
    }
}
