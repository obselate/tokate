package TokateDesktop

import Goo
import System

/// What every page needs from the shell this frame: the command button template, whether a command
/// is running, and the window layout.
data struct PageContext {
    var Button CommandButton
    var Busy bool
    /// Whether the running command started on the visible page.
    var BusyHere bool
    var Metrics LayoutMetrics
    /// Builds the loading state of a list with a message.
    var Loader Func[string, Blob]?
    /// Scrolls the page to its top.
    var OnTop Action?
    var OnPopupKey Action[KeyEvent]?
    var OnPopupPointer Action[PointerEvent]?

    prop CompactPanels bool -> Metrics.ContentWidth < 650

    prop NarrowContent bool -> Metrics.ContentWidth < 540
}
