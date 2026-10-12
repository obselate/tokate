package TokateDesktop

import Goo
import System

class UiDispatcher {
    private let post Func[Action, bool]

    init(post Func[Action, bool]) {
        this.post = post
    }

    func TryPost(action Action) bool -> post(action)

    shared {
        func ForWindow(window Window) UiDispatcher -> UiDispatcher(action -> window.TryPost(action))

        func Inline() UiDispatcher -> UiDispatcher(
            action -> {
                action()
                return true
            }
        )
    }
}
