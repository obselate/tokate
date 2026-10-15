package TokateDesktop

import Goo
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import System

/// Action buttons are primary or real secondary. Quiet is reserved for tertiary navigation.
enum ButtonKind {
    Action,
    Quiet,
    Tab,
    Segment,
    Icon
}

/// The intent of an action, independent of its primary or secondary emphasis.
enum ButtonTone {
    Default,
    Positive,
    Danger
}

/// A button that starts a command. While its command runs it becomes the cancel control. A tab or segment
/// keeps its label then: a segment above the pulse line, a tab with a pulse of the label.
///
/// Session fields (`Busy`, `Running`, `ActiveAction`, `Stopping`, `Pulse`, `ActivityTitle`, `OnCancel`,
/// `OnActivate`) are shared by every command button on a page, so build one template and derive buttons
/// from it with `with`.
///
/// `Icon` names a symbol. Icon buttons show it in place of the label; other kinds show it after the label,
/// or before it when `IconFirst` is set.
/// `Count` adds a number after the label. `Name` replaces the label as the accessible name and as the
/// action that activity is matched to, for short labels that repeat in a list.
data struct CommandButton {
    var Label string
    var Name string
    var OnClick Action?
    var Primary bool
    var Tone ButtonTone
    var Disabled bool
    var Kind ButtonKind
    var Icon string
    var IconFirst bool
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

    prop Identity string -> (Name ?? "") == "" ? Label: Name

    prop Loading bool -> Running && ActiveAction == Identity

    func Build() Blob {
        let p = AppTheme.Current
        let label = Label
        let identity = Identity
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
        let color = Tone == ButtonTone.Positive ? p.Ok: Tone == ButtonTone.Danger ? p.Fail: p.Ink
        let tonal = framed && !choice && Tone != ButtonTone.Default
        let size = Kind == ButtonKind.Segment ? AppTheme.SmallSize: AppTheme.BodySize
        let height = Kind == ButtonKind.Segment ? AppTheme.CompactButtonHeight: AppTheme.ButtonHeight
        let ink = filled ? p.Paper: tonal ? color: choice && !Primary ? p.Muted: p.Ink
        let rest = filled ? color: tonal ? AppTheme.Mix(p.Surface, color, 0.10): Kind == ButtonKind.Segment && Primary ? p.Paper: framed ? p.Surface: Color.Transparent
        let button = ActionButton{
            Content: iconOnly ? "": label,
            AccessibilityName: loading ? "Cancel command": identity,
            OnClick: () -> {
                if loading {
                    cancel?.Invoke()
                } else {
                    activate?.Invoke(identity)
                    click?.Invoke()
                }
            },
            CreateText: (options) -> Text{
                Content: iconOnly ? "": label,
                FontFamily: AppTheme.BodyFont,
                FontSize: size,
                FontWeight: 400,
                Opacity: !loading ? 1: Kind == ButtonKind.Tab && AppTheme.Motion ? Pulse: choice ? 1: 0,
            },
            Disabled: unavailable,
            BackgroundColor: rest,
            TextColor: ink,
            HoverBackgroundColor: filled ? AppTheme.Mix(color, p.Paper, 0.15): tonal ? AppTheme.Mix(p.Surface, color, 0.18): Kind == ButtonKind.Tab ? Color.Transparent: Kind == ButtonKind.Quiet ? p.Surface: p.Paper,
            ActiveBackgroundColor: filled ? AppTheme.Mix(color, p.Paper, 0.25): tonal ? AppTheme.Mix(p.Surface, color, 0.24): Kind == ButtonKind.Tab ? Color.Transparent: p.Paper,
            DisabledBackgroundColor: filled ? p.Surface: rest,
            DisabledTextColor: !choice ? p.Muted: Disabled ? AppTheme.Mix(p.Muted, p.Paper, 0.5): ink,
            BorderColor: filled && !unavailable ? color: tonal ? AppTheme.Mix(p.Line, color, 0.45): framed || filled ? p.Line: Color.Transparent,
            FocusBorderColor: p.Accent,
            ShowFocusHighlight: AppTheme.FocusVisible,
            FontFamily: AppTheme.BodyFont,
            FontWeight: 400,
            FontSize: size,
            Height: height,
            MinWidth: iconOnly ? AppTheme.ButtonHeight: Kind == ButtonKind.Segment ? AppTheme.CompactButtonMinWidth: Kind == ButtonKind.Action ? AppTheme.ButtonMinWidth: AppTheme.QuietMinWidth,
            BorderRadius: Kind == ButtonKind.Tab ? 0: AppTheme.ControlRadius,
            TransitionMs: AppTheme.Motion && !unavailable && !loading ? 180: 0,
        }.Build()
        button.MaxWidth = Percent(100)
        button.MinHeight = height
        button.Height = height
        button.FlexDirection = FlexDirection.Row
        button.AlignItems = AlignItems.Center
        button.JustifyContent = Kind == ButtonKind.Quiet ? JustifyContent.FlexStart: JustifyContent.Center
        button.Gap = iconOnly ? 0: AppTheme.Space8
        button.Padding = Edges{Left: iconOnly || Kind == ButtonKind.Quiet ? 0: AppTheme.Space16, Right: iconOnly || Kind == ButtonKind.Quiet ? 0: AppTheme.Space16}
        if iconOnly {
            button.Width = AppTheme.ButtonHeight
        }
        if button is Button {
            if symbol != "" && !loading {
                button.Children.Insert(
                    IconFirst ? 0: button.Children.Count,
                    MaterialIcons.Create(symbol, iconOnly ? 22: 16, unavailable ? p.Muted: ink)
                )
            }
            if Count > 0 {
                button.Children.Add(
                    Container{
                        Padding: Edges{Left: AppTheme.Space8, Right: AppTheme.Space8, Top: AppTheme.Space4, Bottom: AppTheme.Space4},
                        BorderRadius: AppTheme.ControlRadius,
                        BackgroundColor: p.Accent,
                        Text{Content: Count.ToString(), FontFamily: AppTheme.BodyFont, FontSize: AppTheme.CodeSize, Color: p.Surface},
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
            } else if !choice {
                notice.Children.Add(Text{Content: Stopping ? "Stopping": "Cancel", FontFamily: AppTheme.BodyFont, FontSize: size})
            }
            button.Children.Add(notice)
            if Kind != ButtonKind.Tab {
                button.Children.Add(
                    Container{
                        Position: PositionType.Absolute,
                        Left: AppTheme.Space12,
                        Right: AppTheme.Space12,
                        Bottom: AppTheme.Space4,
                        Height: 2,
                        BorderRadius: 1,
                        BackgroundColor: filled ? p.Paper: p.Accent,
                        Opacity: AppTheme.Motion ? Pulse: 1,
                    }
                )
            }
        }
        return Interaction.Keyboard(button)
    }
}
