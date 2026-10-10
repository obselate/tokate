package TokateDesktop

/// What every page needs from the shell this frame: the command button template, whether a command
/// is running, and the window layout.
data struct PageContext {
    var Button CommandButton
    var Busy bool
    var Metrics LayoutMetrics

    prop CompactPanels bool -> Metrics.ContentWidth < 650

    prop NarrowContent bool -> Metrics.ContentWidth < 540
}
