package TokateDesktop

import Goo
import Goo.Widgets
import System

/// The window root: navigation beside the workspace, plus an optional overlay. Compact layouts place
/// navigation inside the workspace instead, so `Navigation` is omitted. The owner supplies `Handle` to
/// observe window metrics. `Framed` draws a line and round corners on a window that is not maximized.
///
/// This stays stateless on purpose: Goo rebuilds the Cell that owns a handler, so wrapping the whole
/// tree in a Cell would attribute every page handler to the frame.
data struct AppFrame {
    var Handle ElementHandle
    var Navigation Blob?
    var Workspace Blob
    var Overlay Blob?
    var Framed bool
    var KeyBindings []KeyBinding?
    var OnKeyDown Action[KeyEvent]?
    var OnPointerDown Action[PointerEvent]?

    func Build() Blob {
        let key = OnKeyDown
        let pointer = OnPointerDown
        let root = Container{
            Width: Percent(100),
            Height: Percent(100),
            FlexDirection: FlexDirection.Row,
            Handle: Handle,
            KeyBindings: KeyBindings,
            OnKeyDown: event -> key?.Invoke(event),
            OnPointerDown: event -> pointer?.Invoke(event),
            Overflow: Overflow.Hidden,
            BorderWidth: Framed ? 1: 0,
            BorderRadius: Framed ? AppTheme.PanelRadius: 0,
            BorderColor: AppTheme.Current.Line,
            BackgroundColor: AppTheme.Current.Paper,
            FontFamily: AppTheme.BodyFont,
            Color: AppTheme.Current.Ink,
            Workspace,
        }
        if let navigation = Navigation {
            root.Children.Insert(0, navigation)
        }
        if let overlay = Overlay {
            root.Children.Add(Container{Key: "dialog", Width: 0, Height: 0, overlay})
        }
        return root
    }
}
