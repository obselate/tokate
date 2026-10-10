package TokateDesktop

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import System

partial class ThemedControls {
    private let refresh Action
    private let cancel Action
    private let activate Action[string]
    private let focus Action[bool]
    var Busy bool
    var Loading bool
    var Stopping bool
    var ActionName string = ""
    var ActivityTitle string = ""
    var ContentWidth float64 = 998
    var WindowWidth float64 = 1280
    var WindowHeight float64 = 860
    var KeyboardFocus bool
    var Motion bool = true
    var Twilight float64
    var LoadingPulse float64 = 1.0

    init(refresh Action, cancel Action, activate Action[string], focus Action[bool]) {
        this.refresh = refresh
        this.cancel = cancel
        this.activate = activate
        this.focus = focus
    }

    func ThemeColor(daylight string, moonlight string) Color -> AppTheme.Mix(
        Color.Parse(daylight),
        Color.Parse(moonlight),
        AppTheme.Twilight
    )

    func Paper() Color -> AppTheme.Current.Paper

    func Surface() Color -> AppTheme.Current.Surface

    func Ink() Color -> AppTheme.Current.Ink

    func Muted() Color -> AppTheme.Current.Muted

    func Accent() Color -> AppTheme.Current.Accent

    func Line() Color -> AppTheme.Current.Line

    func Label(content string, size float64 = 18, muted bool = false) Text -> Label{
        Content: content,
        Size: size,
        Muted: muted,
    }.Build()

    func Heading(content string, size float64 = 42) Text -> Heading{Content: content, Size: size}.Build()

    func Rule() Blob -> Rule{}.Build()

    func Keyboard(button Blob) Blob -> Interaction.Keyboard(button)

    func RevealFocus(control Blob) Blob -> Interaction.RevealFocus(control)

    func FocusStyle() Style -> AppTheme.FocusStyle()

    func FocusHints(value bool) -> focus(value)

    func KeyNavigation(event KeyEvent) {
        if event.Key == Key.Tab ||
            event.Key == Key.Left ||
            event.Key == Key.Right ||
            event.Key == Key.Up ||
            event.Key == Key.Down {
            FocusHints(true)
        }
    }

    /// The command button template carrying this frame's activity state.
    func Command() CommandButton -> CommandButton{
        Busy: Busy,
        Running: Loading,
        ActiveAction: ActionName,
        Stopping: Stopping,
        Pulse: LoadingPulse,
        ActivityTitle: ActivityTitle,
        OnCancel: cancel,
        OnActivate: activate,
    }

    func Action(
        label string,
        click Action,
        primary bool = false,
        disabled bool = false,
        allowWhileBusy bool = false
    ) Blob -> (Command() with{
        Label = label,
        OnClick = click,
        Primary = primary,
        Disabled = disabled,
        AllowWhileBusy = allowWhileBusy,
    }).Build()

    func Entry(
        label string,
        value string,
        change Action[string],
        placeholder string = "",
        width float64 = 400,
        submit Action? = nil
    ) Blob -> InputField{
        Label: label,
        Value: value,
        OnChange: change,
        Placeholder: placeholder,
        Width: width,
        OnSubmit: submit,
        Disabled: Busy,
    }.Build()

    func Dropdown(
        label string,
        value string,
        values[]ComboBoxOption,
        change Action[string],
        width float64
    ) Blob -> Dropdown{
        Caption: label,
        Value: value,
        Options: values,
        OnChange: selected -> {
            change(selected)
            refresh()
        },
        Width: width,
        Disabled: Busy,
        OnPopupKey: event -> KeyNavigation(event),
        OnPopupPointer: event -> FocusHints(false),
    }.Build()

    func Check(label string, value bool, change Action[bool]) Blob -> Check{
        Label: label,
        Value: value,
        OnChange: change,
        Disabled: Busy,
    }.Build()

    func Row(children[]Blob) Container -> Row{Children: children}.Build()

    func CancelCommand() Blob -> CancelButton{Stopping: Stopping, OnCancel: cancel}.Build()

    func Short() bool -> WindowHeight < 600

    func Compact() bool -> WindowWidth < 900 || Short()

    func Panel() Container -> Panel{Compact: ContentWidth < 650}.Build()

    func ChoiceCard(title string, detail string, icon string, selected bool, choose Action) Blob ->
    ChoiceCard{
        Title: title,
        Detail: detail,
        Icon: icon,
        Selected: selected,
        OnChoose: choose,
        Disabled: Busy,
    }.Build()

    func SummaryTile(title string, value string, icon string) Blob -> SummaryTile{
        Title: title,
        Value: value,
        Icon: icon,
    }.Build()

    func ReviewDetail(label string, value string) Blob -> DetailRow{Caption: label, Value: value}.Build()

    func StatusBadge(value string) Blob -> StatusBadge{Value: value}.Build()
}
