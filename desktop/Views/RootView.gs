package TokateDesktop

import Goo
import Goo.Animations
import Goo.Widgets
import System
import System.Collections.Generic

/// The root Cell: the navigation, title bar, current page, feedback and confirmation dialog. It owns the
/// shell animations because Goo animations belong to a Cell.
class RootView : Cell {
    private let app DesktopApp
    private let session DesktopSession
    private let ui ThemedControls
    private let donate DonateView
    private let project ProjectView
    private let saved SavedWorkScreen
    private let welcome WelcomeView
    private let appearance AppearanceView
    private let loadingPulse Anim[float64]
    private var pulseElapsed int32 = -1
    private var pulsing bool

    init(app DesktopApp) {
        this.app = app
        app.Theme.Bind(Animate(0.0))
        loadingPulse = Animate(1.0)
        session = DesktopSession(
            app,
            () -> Refresh(),
            next -> Navigate(Destinations.Parse(next)),
            path -> saved.Remember(path)
        )
        ui = ThemedControls(
            session.Refresh,
            () -> app.Activity.Cancel(),
            label -> app.Activity.Activate(label),
            value -> app.Window.FocusHints(value)
        )
        donate = DonateView(app.Donation, app.Feedback, next -> Navigate(next), path -> saved.Open(path))
        project = ProjectView(app.Owner)
        app.Commands.RememberRun = path -> saved.Remember(path)
        saved = SavedWorkScreen(
            session,
            ui,
            (run, path) -> {
                Navigate(Destination.Donate)
                app.Donation.Open(run, path)
                app.Donation.Start()
            }
        )
        welcome = WelcomeView(app, next -> Navigate(next))
        appearance = AppearanceView(app)
    }

    /// Whether the window may close. Active commands keep it open with an explanation.
    func Closing() bool {
        if !app.Activity.Busy {
            app.Donation.Stop()
            saved.StopSavedUpdates()
            return true
        }
        app.Feedback.Show("A command is active. Cancel it before closing, then inspect the saved run.")
        Refresh()
        return false
    }

    func Navigate(next Destination) {
        if app.Navigation.Current == Destination.Saved && next != Destination.Saved {
            saved.StopSavedUpdates()
        }
        app.Navigation.Go(next)
        app.Feedback.Clear()
        if next == Destination.Saved {
            saved.Enter()
        }
    }

    /// Advances the loading pulse and rebuilds.
    func Refresh() {
        let activity = app.Activity.Current
        if !activity.Busy {
            loadingPulse.Set(1.0)
            pulsing = false
            pulseElapsed = -1
        } else if !activity.Streaming &&
            app.Navigation.Current == activity.Page &&
            (!pulsing || pulseElapsed != activity.Elapsed) {
            pulsing = true
            pulseElapsed = activity.Elapsed
            loadingPulse.To(activity.Elapsed % 2 == 0 ? 1.0: 0.35, Cubic.Tween(app.Theme.Settings.Motion ? 0.8: 0.0))
        }
        Rebuild()
    }

    private func Sync() {
        let activity = app.Activity.Current
        let metrics = app.Window.Metrics
        app.Theme.Apply()
        ui.Twilight = app.Theme.Twilight
        ui.LoadingPulse = loadingPulse.Value
        ui.Busy = activity.Busy
        ui.Loading = activity.Busy && activity.Visible && app.Navigation.Current == activity.Page && !activity.Streaming
        ui.Stopping = activity.Stopping
        ui.ActionName = activity.ActionName
        ui.ActivityTitle = activity.Title
        ui.KeyboardFocus = app.Window.FocusVisible
        ui.Motion = app.Theme.Settings.Motion
        ui.WindowWidth = metrics.WindowWidth
        ui.WindowHeight = metrics.WindowHeight
        ui.ContentWidth = metrics.ContentWidth
        if let window = app.Window.Window {
            window.Background = AppTheme.Current.Paper
        }
        app.Art.Paint(app.Theme.Twilight, app.Theme.Settings.OilPaint)
    }

    /// The shell state every page builds from this frame.
    private func Page() PageContext {
        let activity = app.Activity.Current
        return PageContext{
            Button: CommandButton{
                Busy: activity.Busy,
                Running: activity.Busy && activity.Visible && app.Navigation.Current == activity.Page && !activity.Streaming,
                ActiveAction: activity.ActionName,
                Stopping: activity.Stopping,
                Pulse: loadingPulse.Value,
                ActivityTitle: activity.Title,
                OnCancel: () -> app.Activity.Cancel(),
                OnActivate: label -> app.Activity.Activate(label),
            },
            Busy: activity.Busy,
            BusyHere: activity.Busy && activity.Page == app.Navigation.Current,
            Metrics: app.Window.Metrics,
            OnPopupKey: event -> app.Window.KeyNavigation(event),
            OnPopupPointer: event -> app.Window.FocusHints(false),
        }
    }

    private func NavigationItem(destination Destination) Blob -> NavItem{
        Title: Destinations.Label(destination),
        Caption: Destinations.Caption(destination),
        Numeral: Destinations.Numeral(destination),
        Selected: app.Navigation.Current == destination,
        Compact: app.Window.Metrics.Compact,
        OnSelect: () -> Navigate(destination),
    }.Build()

    private func Sidebar() Blob {
        let metrics = app.Window.Metrics
        let items = List[Blob]()
        for destination in Destinations.All {
            if destination != Destination.Appearance {
                items.Add(NavigationItem(destination))
            }
        }
        return NavRail{
            Header: Wordmark{Mark: app.Art.Mark.Render(), Narrow: metrics.Narrow}.Build(),
            Items: items.ToArray(),
            Footer: []Blob{NavigationItem(Destination.Appearance)},
            Compact: metrics.Compact,
            Narrow: metrics.Narrow,
        }.Build()
    }

    private func Background(page Destination) Blob {
        if page == Destination.Welcome {
            return Backdrop{Image: app.Art.Backdrop, Effect: app.Art.Effect}.Build()
        }
        let scene Landscape? = switch page {
            case Destination.Donate: app.Art.Scene("donate")
            case Destination.Project: app.Art.Scene("my-project")
            case Destination.Saved: app.Art.Scene("saved-work")
            default: nil
        }
        guard let landscape = scene else {
            return Backdrop{}.Build()
        }
        return Backdrop{
            Image: landscape.Daylight,
            NightImage: landscape.Moonlight,
            Effect: app.Art.LandscapeEffect,
            Twilight: app.Theme.Twilight,
            Opacity: 0.65,
        }.Build()
    }

    private func ConfirmationBody(confirmation Confirmation) Blob? {
        if let content = session.ConfirmationContent {
            return content()
        }
        if !confirmation.HasSummary {
            return nil
        }
        let body = List[Blob]()
        if confirmation.Heading != "" {
            body.Add(Heading{Content: confirmation.Heading, Size: 25}.Build())
        }
        if confirmation.Tiles.Length > 0 {
            let tiles = List[Blob]()
            for tile in confirmation.Tiles {
                tiles.Add(SummaryTile{Title: tile.Title, Value: tile.Value, Icon: tile.Icon}.Build())
            }
            body.Add(Row{Children: tiles.ToArray()}.Build())
        }
        for detail in confirmation.Details {
            body.Add(DetailRow{Caption: detail.Label, Value: detail.Value}.Build())
        }
        return Stack{Gap: 16, Children: body.ToArray()}.Build()
    }

    private func Dialog(confirmation Confirmation) Blob {
        let metrics = app.Window.Metrics
        return ConfirmDialog{
            Open: true,
            Title: confirmation.Title,
            Text: confirmation.Text,
            Content: ConfirmationBody(confirmation),
            ConfirmLabel: confirmation.ConfirmLabel,
            WindowWidth: metrics.WindowWidth,
            Compact: metrics.Compact,
            Short: metrics.Short,
            KeyBindings: WidgetKeyBindings.Editing(app.Window.PlatformInput),
            OnKeyDown: event -> app.Window.KeyNavigation(event),
            OnPointerDown: event -> app.Window.FocusHints(false),
            OnCancel: () -> app.Dialogs.Dismiss(),
            OnConfirm: () -> app.Dialogs.Confirm(),
        }.Build()
    }

    override func Build() Blob {
        Sync()
        let metrics = app.Window.Metrics
        let page = app.Navigation.Current
        let content = switch page {
            case Destination.Donate: donate.Build(Page())
            case Destination.Project: project.Build(Page())
            case Destination.Saved: saved.Build()
            case Destination.Appearance: appearance.Build()
            default: welcome.Build()
        }
        let isWelcome = page == Destination.Welcome
        let donating = page == Destination.Donate && donate.IsDonating
        let live = page == Destination.Donate && donate.IsLive
        let browsing = switch page {
            case Destination.Donate: donate.IsBrowsing
            case Destination.Saved: saved.IsBrowsing
            case Destination.Project: project.IsBrowsing
            default: false
        }
        let fill = !metrics.Short && (isWelcome || live || browsing)
        let frame = PageFrame{
            Key: page == Destination.Donate ? donate.Key: page == Destination.Project ? project.Key: Destinations.Label(page),
            Handle: app.Window.ContentViewport,
            Fill: fill,
            Wide: isWelcome,
            Stretch: browsing && !metrics.Short,
            Children: []Blob{content},
        }.Build()
        let feedback = app.Feedback.Current
        if feedback.Message != "" && !donating && page != Destination.Donate {
            frame.Children.Add(Notice{Message: feedback.Message}.Build())
        }
        if feedback.Report != "" && !donating && page != Destination.Donate {
            frame.Children.Add(ReportText{Content: feedback.Report}.Build())
        }
        var overlay Blob? = nil
        if let confirmation = app.Dialogs.Current {
            overlay = Dialog(confirmation)
        }
        return AppFrame{
            Handle: app.Window.Viewport,
            Navigation: metrics.Compact ? nil: Sidebar(),
            Workspace: Workspace{
                Background: Background(page),
                Bar: WindowBar.Mount(
                    "chrome",
                    WindowBarInput{
                        Host: app.Window.Window,
                        Transparent: isWelcome,
                        Night: app.Theme.Settings.Night,
                        OnToggleTheme: () -> app.Theme.Toggle(),
                    }
                ),
                Navigation: metrics.Compact ? Sidebar(): nil,
                Content: frame,
                Scrolls: !fill,
                Padding: isWelcome ? 0: metrics.Compact ? 16: 28,
            }.Build(),
            Overlay: overlay,
            KeyBindings: WidgetKeyBindings.Editing(app.Window.PlatformInput),
            OnKeyDown: event -> app.Window.KeyNavigation(event),
            OnPointerDown: event -> app.Window.FocusHints(false),
        }.Build()
    }
}
