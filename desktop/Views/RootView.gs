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
    private let donate DonateView
    private let project ProjectView
    private let saved SavedView
    private let welcome WelcomeView
    private let appearance AppearanceView
    private let profiles ProfilesView
    private let loadingPulse Anim[float64]
    private var pulseElapsed int32 = -1
    private var pulsing bool

    init(app DesktopApp) {
        this.app = app
        app.Theme.Bind(Animate(app.Theme.Settings.Night ? 1.0: 0.0))
        loadingPulse = Animate(1.0)
        donate = DonateView(app.Donation, app.Art, next -> Navigate(next), path -> OpenSaved(path))
        project = ProjectView(app.Owner, app.Art)
        saved = SavedView(app.Saved)
        welcome = WelcomeView(app, next -> Navigate(next), path -> OpenSaved(path))
        appearance = AppearanceView(app)
        profiles = ProfilesView(app.Profiles, app.Art)
        app.Commands.RememberRun = path -> app.Saved.Remember(path)
        app.Saved.OnWork = (run, path) -> {
            Navigate(Destination.Donate)
            app.Donation.Open(run, path)
            app.Donation.Start()
        }
    }

    /// Whether the window may close. Active commands keep it open with an explanation.
    func Closing() bool {
        if !app.Activity.Busy {
            app.Donation.Stop()
            app.Saved.StopUpdates()
            return true
        }
        app.Feedback.Show("A command is active. Cancel it before closing, then inspect the saved run.")
        Refresh()
        return false
    }

    func Navigate(next Destination) {
        if app.Navigation.Current == Destination.Saved && next != Destination.Saved {
            app.Saved.StopUpdates()
        }
        app.Navigation.Go(next)
        app.Feedback.Clear()
        if next == Destination.Saved {
            app.Saved.Enter()
        }
        if next == Destination.Project {
            app.Owner.Enter()
        }
        if next == Destination.Donate {
            app.Donation.Enter()
        }
        if next == Destination.Profiles {
            app.Profiles.Enter()
        }
        if next == Destination.Welcome {
            app.Welcome.Refresh(app.Saved.Current.RunPath)
        }
    }

    /// Shows the saved run at `path`.
    private func OpenSaved(path string) {
        app.Saved.SetRunPath(path)
        Navigate(Destination.Saved)
        app.Saved.LoadRun()
    }

    /// Advances the loading pulse and rebuilds.
    func Refresh() {
        let activity = app.Activity.Current
        if !activity.Busy {
            loadingPulse.Set(1.0)
            pulsing = false
            pulseElapsed = -1
        } else if !(activity.Streaming && app.Navigation.Current == activity.Page) &&
            (!pulsing || pulseElapsed != activity.Elapsed) {
            pulsing = true
            pulseElapsed = activity.Elapsed
            loadingPulse.To(activity.Elapsed % 2 == 0 ? 1.0: 0.35, Cubic.Tween(app.Theme.Settings.Motion ? 0.8: 0.0))
        }
        Rebuild()
    }

    private func Sync() {
        app.Theme.Apply()
        app.Art.Paint(app.Theme.Twilight, app.Theme.Settings.OilPaint)
    }

    private func CancelActivity() {
        if app.Donation.Current.RepositoryMode && app.Donation.Current.Progress.Running {
            app.Donation.StopRepository()
        } else {
            app.Activity.Cancel()
        }
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
                OnCancel: () -> CancelActivity(),
                OnActivate: label -> app.Activity.Activate(label),
            },
            Busy: activity.Busy,
            BusyHere: activity.Busy && activity.Page == app.Navigation.Current,
            Feedback: app.Feedback.Current,
            Metrics: app.Window.Metrics,
            Loader: message -> SkyLoader.Mount(SkyLoaderInput{Message: message, Sun: app.Art.Sun, Moon: app.Art.Moon}),
            OnTop: () -> app.Window.ContentScroller.JumpTo(0, 0),
            Popup: PopupInput{
                KeyBindings: WidgetKeyBindings.Editing(app.Window.PlatformInput),
                OnKeyDown: event -> app.Window.KeyNavigation(event),
                OnPointerDown: event -> app.Window.FocusHints(false),
            },
        }
    }

    private func NavigationItem(destination Destination) Blob -> NavItem{
        Title: Destinations.Label(destination),
        Caption: Destinations.Caption(destination),
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
            case Destination.Profiles: app.Art.Scene("donate")
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
        if !confirmation.HasSummary {
            return nil
        }
        let body = List[Blob]()
        if !String.IsNullOrEmpty(confirmation.Heading) {
            body.Add(Heading{Content: confirmation.Heading}.Build())
        }
        if confirmation.Tiles.Length > 0 {
            let tiles = List[Blob]()
            for tile in confirmation.Tiles {
                tiles.Add(StatTile{Title: tile.Title, Value: tile.Value, Icon: tile.Icon}.Build())
            }
            body.Add(Row{Children: tiles.ToArray()}.Build())
        }
        for detail in confirmation.Details {
            body.Add(DetailRow{Caption: detail.Label, Value: detail.Value}.Build())
        }
        if !String.IsNullOrEmpty(confirmation.Text) {
            body.Add(Label{Content: confirmation.Text}.Build())
        }
        return Stack{Gap: AppTheme.Space16, Children: body.ToArray()}.Build()
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
            case Destination.Saved: saved.Build(Page())
            case Destination.Profiles: profiles.Build(Page())
            case Destination.Appearance: appearance.Build(Page())
            default: welcome.Build(Page())
        }
        let isWelcome = page == Destination.Welcome
        let activity = app.Activity.Current
        let away = activity.Busy && activity.Visible && activity.Page != page
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
                        Night: app.Theme.Settings.Night,
                        Compact: metrics.Compact,
                        Running: away ? activity.Title: "",
                        Elapsed: DonationProgress.ElapsedText(activity.Elapsed),
                        Stopping: activity.Stopping,
                        Pulse: loadingPulse.Value,
                        OnToggleTheme: () -> app.Theme.Toggle(),
                        OnShowRunning: () -> Navigate(activity.Page),
                        OnCancel: () -> CancelActivity(),
                    }
                ),
                Navigation: metrics.Compact ? Sidebar(): nil,
                Content: frame,
                Scrolls: !fill,
                Scroller: app.Window.ContentScroller,
                Padding: isWelcome ? 0: AppTheme.PageGutter,
            }.Build(),
            Overlay: overlay,
            Framed: app.Window.Framed,
            KeyBindings: WidgetKeyBindings.Editing(app.Window.PlatformInput),
            OnKeyDown: event -> app.Window.KeyNavigation(event),
            OnPointerDown: event -> app.Window.FocusHints(false),
        }.Build()
    }
}
