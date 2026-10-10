package TokateDesktop

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import System

data struct WindowBarInput {
    var Host Window?
    var Transparent bool
    var Night bool
    var OnToggleTheme Action?
}

/// The custom title bar: drag area, window controls and the daylight/moonlight switch.
open class WindowBar : Cell[WindowBarInput] {
    private var hover WindowChromeAction?

    protected override func Build(input WindowBarInput) Blob {
        let p = AppTheme.Current
        let toggle = input.OnToggleTheme
        return WindowChrome{
            Host: input.Host,
            Height: 42,
            BackgroundColor: input.Transparent ? Color.Transparent: p.Paper,
            BorderColor: Color.Transparent,
            ControlColor: p.Muted,
            HoverBackgroundColor: p.Surface,
            CloseHoverBackgroundColor: p.CloseHover,
            EnableDoubleClick: true,
            CreateControlContent: (options, command) -> MaterialIcons.Create(
                switch command {
                    case WindowChromeAction.Minimize: "remove"
                    case WindowChromeAction.Maximize: "crop_square"
                    case WindowChromeAction.Restore: "filter_none"
                    default: "close"
                },
                18,
                hover == command ? (command == WindowChromeAction.Close ? AppTheme.CloseInk: p.Ink): p.Muted
            ),
            CreateControl: (options, command, content, action) -> Button{
                Width: options.ControlWidth,
                Height: 32,
                Margin: Edges{Right: 4},
                BorderRadius: 4,
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
                Hover: Style{
                    BackgroundColor: command == WindowChromeAction.Close ? p.CloseHover: p.ChromeHover
                },
            },
            TrailingContent: IconButton{
                Icon: MaterialIcons.Create(input.Night ? "light_mode": "dark_mode", 20, p.Accent),
                AccessibilityName: input.Night ? "Switch to daylight": "Switch to moonlight",
                OnClick: () -> toggle?.Invoke(),
                Width: 46,
                Height: 42,
                BorderRadius: 0,
                HoverBackgroundColor: p.Surface,
                ShowFocusHighlight: AppTheme.FocusVisible,
                FocusOutlineColor: p.Accent,
            }.Build(),
        }.Build()
    }

    shared {
        func Mount(key string, input WindowBarInput) Blob -> Cell.Mount[WindowBarInput, WindowBar](key, input)
    }
}
