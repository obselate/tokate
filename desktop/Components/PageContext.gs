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
    /// What a popup outside the page needs from the window.
    var Popup PopupInput
    var Feedback Feedback

    prop NarrowContent bool -> Metrics.ContentWidth < AppTheme.NarrowBreakpoint

    /// Places feedback below the complete page header, before the page content.
    func Layout(header Blob, children []Blob, fill bool = false, notices []Blob? = nil) Blob {
        let body = Stack{Gap: AppTheme.SectionGap, Fill: fill, Children: []Blob{header}}.Build()
        let banner = Stack{Gap: AppTheme.Space8, Children: []Blob{}}.Build()
        if (Feedback.Message ?? "") != "" {
            banner.Children.Add(Callout{Message: Feedback.Message, Tone: Feedback.Tone}.Build())
        }
        for notice in notices ?? []Blob{} {
            banner.Children.Add(notice)
        }
        if (Feedback.Report ?? "") != "" {
            banner.Children.Add(OutputPanel{
                Title: "Report",
                LineCount: Feedback.Report.TrimEnd().Split('\n').Length,
                Children: []Blob{Container{Padding: AppTheme.Space24, ReportText{Content: Feedback.Report}.Build()}},
            }.Build())
        }
        if banner.Children.Count > 0 {
            body.Children.Add(banner)
        }
        for child in children {
            body.Children.Add(child)
        }
        return body
    }
}
