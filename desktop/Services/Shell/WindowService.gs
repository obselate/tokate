package TokateDesktop

import Goo
import System

/// The native window: layout metrics, keyboard focus hints, timers and the UI-thread dispatcher.
class WindowService {
    private let changed Action
    let Viewport ElementHandle = ElementHandle()
    let ContentViewport ElementHandle = ElementHandle()
    let ContentScroller ElementHandle = ElementHandle()
    var Window Window?
    var Metrics LayoutMetrics = LayoutMetrics.Initial
    var FocusVisible bool
    let Dispatcher UiDispatcher

    init(changed Action) {
        this.changed = changed
        Dispatcher = UiDispatcher(action -> Post(action))
        Viewport.MetricsChanged += metrics -> {
            let box = metrics.BorderBox
            if Math.Abs(Metrics.WindowWidth - box.Width) > 0.5 || Math.Abs(Metrics.WindowHeight - box.Height) > 0.5 {
                Metrics = Metrics with{WindowWidth = box.Width, WindowHeight = box.Height}
                changed()
            }
        }
        ContentViewport.MetricsChanged += metrics -> {
            if Math.Abs(Metrics.ContentWidth - metrics.BorderBox.Width) > 0.5 {
                Metrics = Metrics with{ContentWidth = metrics.BorderBox.Width}
                changed()
            }
        }
    }

    func Attach(window Window) {
        Window = window
        window.SmoothScrolling = true
        window.WheelScrollScale = 2.0F
        window.StateChanged += state -> changed()
    }

    /// Runs `action` on the UI thread. Returns false when no window can accept it.
    func Post(action Action) bool -> Window?.TryPost(action) ?? false

    /// Runs `action` on the UI thread every `milliseconds` until the result is disposed.
    func Every(milliseconds int32, action Action) IDisposable? -> Window?.SetInterval(action, milliseconds)

    /// Whether the window is neither maximized nor fullscreen, so it shows its own edge.
    prop Framed bool -> Window?.State == WindowState.Normal

    prop PlatformInput PlatformInput? -> Window?.PlatformInput

    prop ReducedMotion bool -> Window?.Preferences.ReducedMotion == true

    func FocusHints(value bool) {
        if FocusVisible != value {
            FocusVisible = value
            changed()
        }
    }

    /// Shows focus rings once the keyboard is used to move focus.
    func KeyNavigation(event KeyEvent) {
        if event.Key == Key.Tab ||
            event.Key == Key.Left ||
            event.Key == Key.Right ||
            event.Key == Key.Up ||
            event.Key == Key.Down {
            FocusHints(true)
        }
    }
}
