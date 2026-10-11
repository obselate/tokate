package TokateDesktop

import Goo
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import System

/// The shape of a command button. Tabs and segments show `Primary` as the selected state.
enum ButtonKind {
    Action,
    Quiet,
    Tab,
    Segment,
    Icon
}

/// A button that starts a command. While its command runs it becomes the cancel control.
///
/// Session fields (`Busy`, `Running`, `ActiveAction`, `Stopping`, `Pulse`, `ActivityTitle`, `OnCancel`,
/// `OnActivate`) are shared by every command button on a page, so build one template and derive buttons
/// from it with `with`.
///
/// `Icon` names a symbol. Icon buttons show it in place of the label; other kinds show it after the label.
/// `Count` adds a number after the label.
data struct CommandButton {
    var Label string
    var OnClick Action?
    var Primary bool
    var Disabled bool
    var Kind ButtonKind
    var Icon string
    var Count int32
    var AllowWhileBusy bool
    var Busy bool
    var Running bool
    var ActiveAction string
    var Stopping bool
    var Pulse float64
    var ActivityTitle string
    var OnCancel Action?
    var OnActivate Action[string]?

    prop Loading bool -> Running && ActiveAction == Label

    func Build() Blob {
        let p = AppTheme.Current
        let label = Label
        let click = OnClick
        let cancel = OnCancel
        let activate = OnActivate
        let loading = Loading
        let unavailable = Disabled || (Busy && !loading && !AllowWhileBusy) || (loading && Stopping)
        let symbol = Icon ?? ""
        let iconOnly = Kind == ButtonKind.Icon
        let choice = Kind == ButtonKind.Tab || Kind == ButtonKind.Segment
        let filled = Kind == ButtonKind.Action && Primary
        let framed = Kind == ButtonKind.Action || iconOnly || (Kind == ButtonKind.Segment && Primary)
        let size = Kind == ButtonKind.Segment ? AppTheme.SmallSize: AppTheme.BodySize
        let height = Kind == ButtonKind.Segment ? 36.0: 44.0
        let ink = filled ? p.Paper: choice && !Primary ? p.Muted: p.Ink
        let rest = filled ? p.Ink: Kind == ButtonKind.Segment && Primary ? p.Paper: framed ? p.Surface: Color.Transparent
        let button = ActionButton{
            Content: iconOnly ? "": label,
            AccessibilityName: loading ? "Cancel command": label,
            OnClick: () -> {
                if loading {
                    cancel?.Invoke()
                } else {
                    activate?.Invoke(label)
                    click?.Invoke()
                }
            },
            CreateText: (options) -> Text{
                Content: iconOnly ? "": label,
                FontFamily: AppTheme.BodyFont,
                FontSize: size,
                FontWeight: 400,
                Opacity: loading ? 0: 1,
            },
            Disabled: unavailable,
            BackgroundColor: rest,
            TextColor: ink,
            HoverBackgroundColor: filled ? p.Accent: Kind == ButtonKind.Tab ? Color.Transparent: Kind == ButtonKind.Quiet ? p.Surface: p.Paper,
            ActiveBackgroundColor: p.Accent,
            DisabledBackgroundColor: filled ? p.Surface: rest,
            DisabledTextColor: choice ? AppTheme.Mix(p.Muted, p.Paper, 0.5): p.Muted,
            BorderColor: filled ? p.Ink: framed ? p.Line: Color.Transparent,
            FocusBorderColor: p.Accent,
            ShowFocusHighlight: AppTheme.FocusVisible,
            FontFamily: AppTheme.BodyFont,
            FontWeight: 400,
            FontSize: size,
            Height: height,
            MinWidth: Kind == ButtonKind.Action ? 0: iconOnly ? 44: 24,
            BorderRadius: Kind == ButtonKind.Tab ? 0: Kind == ButtonKind.Segment ? 3: AppTheme.ControlRadius,
            TransitionMs: AppTheme.Motion && !unavailable && !loading ? 180: 0,
        }.Build()
        button.MaxWidth = Percent(100)
        button.MinHeight = height
        button.Height = Length.Auto
        button.FlexDirection = FlexDirection.Row
        button.AlignItems = AlignItems.Center
        button.JustifyContent = JustifyContent.Center
        button.Gap = iconOnly ? 0: 8
        button.Padding = iconOnly ? Edges{Left: 0, Right: 0}: Kind == ButtonKind.Segment ? Edges{Left: 12, Right: 12, Top: 6, Bottom: 6}: Edges{
            Left: 16,
            Right: 16,
            Top: 10,
            Bottom: 10,
        }
        if iconOnly {
            button.Width = 44
        }
        if button is Button {
            if symbol != "" && !loading {
                button.Children.Add(MaterialIcons.Create(symbol, iconOnly ? 22: 16, unavailable ? p.Muted: ink))
            }
            if Count > 0 {
                button.Children.Add(
                    Container{
                        Padding: Edges{Left: 7, Right: 7, Top: 2, Bottom: 2},
                        BorderRadius: AppTheme.ControlRadius,
                        BackgroundColor: p.Accent,
                        Text{Content: Count.ToString(), FontFamily: AppTheme.BodyFont, FontSize: AppTheme.CodeSize, Color: p.Surface},
                    }
                )
            }
            if Kind == ButtonKind.Tab {
                button.Children.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: 0,
                        Right: 0,
                        Bottom: 0,
                        Height: 2,
                        BackgroundColor: Primary ? p.Accent: Color.Transparent,
                    }
                )
            }
        }
        if loading && button is Button {
            button.Accessibility = Accessibility{
                Role: AccessibilityRole.Button,
                Name: "Cancel command",
                Description: ActivityTitle,
                Busy: true,
            }
            let notice = Container{
                Position: PositionType.Absolute,
                Left: 0,
                Right: 0,
                Top: 0,
                Bottom: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
            }
            if iconOnly {
                notice.Children.Add(MaterialIcons.Create("close", 22, ink))
            } else {
                notice.Children.Add(Text{Content: Stopping ? "Stopping": "Cancel", FontFamily: AppTheme.BodyFont, FontSize: size})
            }
            button.Children.Add(notice)
            button.Children.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 10,
                    Right: 10,
                    Bottom: 3,
                    Height: 2,
                    BorderRadius: 1,
                    BackgroundColor: filled ? p.Paper: p.Accent,
                    Opacity: AppTheme.Motion ? Pulse: 1,
                }
            )
        }
        return Interaction.Keyboard(button)
    }
}
