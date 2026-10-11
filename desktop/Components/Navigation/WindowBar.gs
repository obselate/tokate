package TokateDesktop

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import System

/// `Running` is the title of the command that runs on another page, or empty when the chip is not shown.
data struct WindowBarInput {
    var Host Window?
    var Night bool
    var Compact bool
    var Running string
    var Elapsed string
    var Stopping bool
    var Pulse float64
    var OnToggleTheme Action?
    var OnShowRunning Action?
    var OnCancel Action?
}

/// The custom title bar over the page background: drag area, the chip for a command on another page, the
/// daylight/moonlight switch and the window controls.
open class WindowBar : Cell[WindowBarInput] {
    private var hover WindowChromeAction?

    protected override func Build(input WindowBarInput) Blob {
        let p = AppTheme.Current
        let toggle = input.OnToggleTheme
        let theme = IconButton{
            Icon: MaterialIcons.Create(input.Night ? "light_mode": "dark_mode", 20, p.Accent),
            AccessibilityName: input.Night ? "Switch to daylight": "Switch to moonlight",
            OnClick: () -> toggle?.Invoke(),
            Width: 40,
            Height: 32,
            BorderRadius: AppTheme.ControlRadius,
            HoverBackgroundColor: p.ChromeHover,
            ShowFocusHighlight: AppTheme.FocusVisible,
            FocusOutlineColor: p.Accent,
        }.Build()
        theme.Key = "theme"
        let trailing = Row{Children: []Blob{theme}, Gap: 10, NoWrap: true}.Build()
        trailing.Padding = Edges{Right: 12}
        if input.Running != "" {
            let chip = ActivityChip{
                Title: input.Running,
                Elapsed: input.Elapsed,
                Stopping: input.Stopping,
                Pulse: input.Pulse,
                Compact: input.Compact,
                OnOpen: input.OnShowRunning,
                OnCancel: input.OnCancel,
            }.Build()
            chip.Key = "running"
            trailing.Children.Insert(0, chip)
        }
        return WindowChrome{
            Host: input.Host,
            Height: 42,
            ControlWidth: 40,
            BackgroundColor: Color.Transparent,
            BorderColor: Color.Transparent,
            ControlColor: p.Muted,
            HoverBackgroundColor: p.ChromeHover,
            CloseHoverBackgroundColor: p.Fail,
            EnableDoubleClick: true,
            CreateControlContent: (options, command) -> MaterialIcons.Create(
                switch command {
                    case WindowChromeAction.Minimize: "remove"
                    case WindowChromeAction.Maximize: "crop_square"
                    case WindowChromeAction.Restore: "filter_none"
                    default: "close"
                },
                18,
                hover == command ? (command == WindowChromeAction.Close ? p.Surface: p.Ink): p.Muted
            ),
            CreateControl: (options, command, content, action) -> Button{
                Width: options.ControlWidth,
                Height: 32,
                Margin: Edges{Right: 4},
                BorderRadius: AppTheme.ControlRadius,
                Padding: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Focus: AppTheme.FocusStyle(),
                OnPointerEnter: event -> {
                    hover = command
                    Rebuild()
                },
                OnPointerLeave: event -> {
                    hover = nil
                    Rebuild()
                },
                Hover: Style{BackgroundColor: command == WindowChromeAction.Close ? p.Fail: p.ChromeHover},
            },
            TrailingContent: trailing,
        }.Build()
    }

    shared {
        func Mount(key string, input WindowBarInput) Blob -> Cell.Mount[WindowBarInput, WindowBar](key, input)
    }
}
