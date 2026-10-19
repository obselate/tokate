package TokateDesktop

import Goo
import Goo.Widgets

class Interaction {
    shared {
        /// Binds Enter and Space activation and scrolls the control into view on focus.
        func Keyboard(control Blob) Blob {
            WidgetKeyBindings.BindActivation(control)
            return RevealFocus(control)
        }

        /// Scrolls the control into view whenever it receives focus.
        func RevealFocus(control Blob) Blob {
            let handle = control.Handle ?? ElementHandle()
            let focused = control.OnFocus
            control.Handle = handle
            control.OnFocus = event -> {
                focused?.Invoke(event)
                handle.ScrollIntoView()
            }
            return control
        }
    }
}
