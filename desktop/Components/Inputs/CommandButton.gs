package TokateDesktop

import Goo
import Goo.Widgets.Actions
import System

/// A button that starts a command. While its command runs it becomes the cancel control.
///
/// Session fields (`Busy`, `Running`, `ActiveAction`, `Stopping`, `Pulse`, `ActivityTitle`, `OnCancel`,
/// `OnActivate`) are shared by every command button on a page, so build one template and derive buttons
/// from it with `with`.
data struct CommandButton {
    var Label string
    var OnClick Action?
    var Primary bool
    var Disabled bool
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
        let button = ActionButton{
            Content: label,
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
                Content: label,
                FontFamily: AppTheme.BodyFont,
                FontSize: 18,
                FontWeight: 400,
                Opacity: loading ? 0: 1,
            },
            Disabled: unavailable,
            BackgroundColor: Primary ? p.Ink: p.Surface,
            TextColor: Primary ? p.Paper: p.Ink,
            HoverBackgroundColor: Primary ? p.Accent: p.Paper,
            ActiveBackgroundColor: p.Accent,
            DisabledBackgroundColor: p.Surface,
            DisabledTextColor: p.Muted,
            BorderColor: Primary ? p.Ink: p.Line,
            FocusBorderColor: p.Accent,
            ShowFocusHighlight: AppTheme.FocusVisible,
            FontFamily: AppTheme.BodyFont,
            FontWeight: 400,
            FontSize: 18,
            Height: 44,
            BorderRadius: 5,
            TransitionMs: AppTheme.Motion && !unavailable && !loading ? 180: 0,
        }.Build()
        button.MaxWidth = Percent(100)
        button.MinHeight = 44
        button.Height = Length.Auto
        button.Padding = Edges{Left: 16, Right: 16, Top: 10, Bottom: 10}
        if loading && button is Button {
            button.Accessibility = Accessibility{
                Role: AccessibilityRole.Button,
                Name: "Cancel command",
                Description: ActivityTitle,
                Busy: true,
            }
            button.Children.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 0,
                    Right: 0,
                    Top: 0,
                    Bottom: 0,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Text{Content: Stopping ? "Stopping": "Cancel", FontFamily: AppTheme.BodyFont, FontSize: 18},
                }
            )
            button.Children.Add(
                Container{
                    Position: PositionType.Absolute,
                    Left: 10,
                    Right: 10,
                    Bottom: 3,
                    Height: 2,
                    BorderRadius: 1,
                    BackgroundColor: Primary ? p.Paper: p.Accent,
                    Opacity: AppTheme.Motion ? Pulse: 1,
                }
            )
        }
        return Interaction.Keyboard(button)
    }
}
