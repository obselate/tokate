package TokateDesktop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System

/// A modal confirmation with "Go back" and a confirm button. `Content` replaces the plain `Text` body.
data struct ConfirmDialog {
    var Open bool
    var Title string
    var Text string
    var Content Blob?
    var ConfirmLabel string
    var WindowWidth float64
    var Compact bool
    var Short bool
    var KeyBindings []KeyBinding?
    var OnKeyDown Action[KeyEvent]?
    var OnPointerDown Action[PointerEvent]?
    var OnConfirm Action?
    var OnCancel Action?

    func Build() Blob {
        let confirmLabel = ConfirmLabel
        let key = OnKeyDown
        let pointer = OnPointerDown
        let cancel = OnCancel
        let confirm = OnConfirm
        return Cell.Mount[ModalDialog, ModalDialogHost](
            "confirmation",
            ModalDialog{
                Open: Open,
                KeyBindings: KeyBindings,
                Header: Heading{Content: Title}.Build(),
                Content: Container{
                    MinHeight: 0,
                    FlexShrink: 1,
                    OverflowY: Overflow.Scroll,
                    Content ?? Label{Content: Text}.Build(),
                },
                AccessibilityName: Title,
                Width: Math.Min(580, WindowWidth - 32),
                Padding: Compact ? 20: 30,
                Gap: Short ? 12: 20,
                BackgroundColor: AppTheme.Current.Surface,
                BorderColor: AppTheme.Current.Line,
                CancelText: "Go back",
                ConfirmText: confirmLabel,
                CancelContent: Label{Content: "Go back"}.Build(),
                ConfirmContent: Label{Content: confirmLabel, Ink: AppTheme.Current.Paper}.Build(),
                CreateCancel: (options, content) -> DialogButton("Go back", content, false),
                CreateConfirm: (options, content) -> DialogButton(confirmLabel, content, true),
                CreateRoot: (options, backdrop, panel) -> Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: 0,
                    Bottom: 0,
                    ZIndex: options.ZIndex,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    OnKeyDown: event -> key?.Invoke(event),
                    OnPointerDown: event -> pointer?.Invoke(event),
                    backdrop,
                    panel,
                },
                OnCancel: () -> cancel?.Invoke(),
                OnClose: () -> cancel?.Invoke(),
                OnConfirm: () -> confirm?.Invoke(),
            }
        )
    }

    shared {
        private func DialogButton(title string, content Blob, primary bool) Button -> Button{
            Height: 44,
            Padding: Edges{Left: 16, Right: 16},
            BorderWidth: 1,
            BorderColor: primary ? AppTheme.Current.Ink: AppTheme.Current.Line,
            BorderRadius: AppTheme.ControlRadius,
            BackgroundColor: primary ? AppTheme.Current.Ink: AppTheme.Current.Paper,
            Hover: Style{BackgroundColor: primary ? AppTheme.Current.Accent: AppTheme.Current.Surface},
            Focusable: true,
            Focus: AppTheme.FocusStyle(),
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: title},
            content,
        }
    }
}
