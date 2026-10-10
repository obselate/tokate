package TokateDesktop

import Goo
import System

/// The composition root: creates the services and the root view, and connects them to a window.
class DesktopApp {
    let Art ArtworkService
    let Window WindowService
    let Navigation NavigationService
    let Feedback FeedbackService
    let Dialogs DialogService
    let Activity ActivityService
    let Theme ThemeService
    let Commands CommandRunner
    let Owner OwnerService
    let Donation DonationService
    let Root RootView
    private var pending bool

    init(art ArtworkService) {
        let changed = () -> RequestRefresh()
        Art = art
        Window = WindowService(changed)
        Navigation = NavigationService(changed)
        Feedback = FeedbackService(changed)
        Dialogs = DialogService(changed)
        Activity = ActivityService(Window, Navigation, Feedback, changed)
        Theme = ThemeService(Window, changed)
        Commands = CommandRunner(Activity, Feedback, Navigation)
        Owner = OwnerService(Commands, Activity, Feedback, Dialogs, changed)
        Donation = DonationService(Commands, Activity, Feedback, Dialogs, Navigation, Window, changed)
        Root = RootView(this)
    }

    shared {
        func Create(art ArtworkService) DesktopApp -> DesktopApp(art)
    }

    /// Schedules one root rebuild on the UI thread. Requests made before it runs are merged.
    func RequestRefresh() {
        if pending {
            return
        }
        pending = Window.Post(
            () -> {
                pending = false
                Root.Refresh()
            }
        )
    }

    func Attach(window Window) {
        Window.Attach(window)
        Art.Attach(Window.Dispatcher, () -> RequestRefresh())
        window.OnClosing = () -> Root.Closing()
        window.PreferencesChanged += preferences -> {
            if preferences.ReducedMotion == true {
                Theme.SetMotion(false)
            }
            Root.Refresh()
        }
    }
}
