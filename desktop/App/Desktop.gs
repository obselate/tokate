package TokateDesktop

import Goo
import Goo.Animations
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import System
import System.Numerics

class Desktop : Cell {
    private let viewport ElementHandle = ElementHandle()
    private let contentViewport ElementHandle = ElementHandle()
    private var narrow bool
    private let art ArtworkService
    private let twilight Anim[float64]
    private let loadingPulse Anim[float64]
    private var night bool
    private var oilPaint bool = true
    private let app DesktopSession
    private let ui ThemedControls
    private let donor DonationScreen
    private let owner OwnerScreen
    private let saved SavedWorkScreen
    private var pulseElapsed int32 = -1
    private var pulsing bool

    init(assets ArtworkService) {
        art = assets
        app = DesktopSession(() -> Refresh(), next -> Navigate(next), path -> saved.Remember(path))
        ui = ThemedControls(
            app.Refresh,
            () -> app.Cancel(),
            label -> {
                app.ActionName = label
            }
        )
        donor = DonationScreen(app, ui, path -> saved.Open(path), path -> saved.Remember(path))
        owner = OwnerScreen(app, ui)
        saved = SavedWorkScreen(
            app,
            ui,
            (value, path) -> {
                donor.OpenDonation(value, path)
                donor.StartDonation()
            }
        )
        twilight = Animate(0.0)
        loadingPulse = Animate(1.0)
        viewport.MetricsChanged += metrics -> {
            if Math.Abs(ui.WindowWidth - metrics.BorderBox.Width) > 0.5 || Math.Abs(
                ui.WindowHeight - metrics.BorderBox.Height
            ) > 0.5 {
                Resize(metrics.BorderBox.Width, metrics.BorderBox.Height)
            }
        }
        contentViewport.MetricsChanged += metrics -> {
            if Math.Abs(ui.ContentWidth - metrics.BorderBox.Width) > 0.5 {
                ui.ContentWidth = metrics.BorderBox.Width
                app.Refresh()
            }
        }
    }

    func Attach(window Window) {
        app.Window = window
        art.Attach(UiDispatcher.ForWindow(window), () -> app.Refresh())
        window.SmoothScrolling = true
        window.WheelScrollScale = 2.0F
        window.OnClosing = () -> {
            if !app.Busy {
                donor.Stop()
                saved.StopSavedUpdates()
                return true
            }
            app.Message = "A command is active. Cancel it before closing, then inspect the saved run."
            app.Refresh()
            return false
        }
        window.PreferencesChanged += preferences -> {
            if preferences.ReducedMotion == true {
                ui.Motion = false
            }
            app.Refresh()
        }
    }

    private func Navigate(next string) {
        if app.Page == "Saved work" && next != app.Page {
            saved.StopSavedUpdates()
        }
        app.Page = next
        app.Report = ""
        app.Message = ""
        if next == "Saved work" {
            saved.Enter()
        }
    }

    private func Refresh() {
        if !app.Busy {
            loadingPulse.Set(1.0)
            pulsing = false
            pulseElapsed = -1
        } else if !app.Streaming && app.Page == app.ActivePage && (!pulsing || pulseElapsed != app.Elapsed) {
            pulsing = true
            pulseElapsed = app.Elapsed
            loadingPulse.To(app.Elapsed % 2 == 0 ? 1.0: 0.35, Cubic.Tween(ui.Motion ? 0.8: 0.0))
        }
        Rebuild()
    }

    private func ToggleTheme() {
        night = !night
        twilight.To(
            night ? 1.0: 0.0,
            Cubic.Tween(ui.Motion && app.Window?.Preferences.ReducedMotion != true ? 1.1: 0.0)
        )
        app.Refresh()
    }

    private func Resize(width float64, height float64) {
        ui.WindowWidth = width
        ui.WindowHeight = height
        narrow = width < 1120
        app.Refresh()
    }

    private func Navigation(label string, index string) Blob -> NavItem{
        Title: label,
        Caption: switch label {
            case "Appearance": "Theme"
            case "My project": "Project"
            case "Saved work": "Saved"
            default: label
        },
        Numeral: index,
        Selected: app.Page == label,
        Compact: ui.Compact(),
        OnSelect: () -> app.Navigate(label),
    }.Build()

    private func Sidebar() Blob -> NavRail{
        Header: Wordmark{Mark: art.Mark.Render(), Narrow: narrow}.Build(),
        Items: []Blob{
            Navigation("Welcome", "I"),
            Navigation("Donate", "II"),
            Navigation("My project", "III"),
            Navigation("Saved work", "IV"),
        },
        Footer: []Blob{Navigation("Appearance", "V")},
        Compact: ui.Compact(),
        Narrow: narrow,
    }.Build()

    private func HeroHeight() float64 -> ui.ContentWidth * 0.4

    private func Painting(height float64, background bool = true) Blob -> Fresco.Mount(
        "fresco",
        FrescoInput{
            Backdrop: art.Backdrop,
            Sun: art.Sun,
            Moon: art.Moon,
            Hands: art.Hands,
            Effect: art.Effect,
            Night: ui.Twilight,
            Height: height,
            Background: background,
        }
    )

    private func SectionBackground() Blob {
        if app.Page == "Welcome" {
            return Backdrop{Image: art.Backdrop, Effect: art.Effect}.Build()
        }
        let scene Landscape? = switch app.Page {
            case "Donate": art.Scene("donate")
            case "My project": art.Scene("my-project")
            case "Saved work": art.Scene("saved-work")
            default: nil
        }
        guard let landscape = scene else {
            return Backdrop{}.Build()
        }
        return Backdrop{
            Image: landscape.Daylight,
            NightImage: landscape.Moonlight,
            Effect: art.LandscapeEffect,
            Twilight: ui.Twilight,
            Opacity: 0.65,
        }.Build()
    }

    private func HomeCard(title string, target string) Blob -> StoneCard{
        Title: title,
        Stone: art.Stone,
        Compact: ui.ContentWidth < 900,
        OnClick: () -> app.Navigate(target),
    }.Build()

    private func Home() Blob -> Container{
        Height: ui.Short() ? Length.Auto: Percent(100),
        MinHeight: 0,
        Gap: 0,
        Painting(ui.Short() ? 160: 0, false),
        Container{
            Width: Percent(100),
            MaxWidth: 1050,
            AlignSelf: AlignSelf.Center,
            Padding: Edges{Left: 24, Right: 24, Bottom: 32},
            Gap: 24,
            HeroTitle{Width: ui.ContentWidth, Title: "Give your inference", Accent: "a purpose."}.Build(),
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: ui.ContentWidth < 900 ? 12: 24,
                JustifyContent: JustifyContent.Center,
                HomeCard("Donate AI time", "Donate"),
                HomeCard("Open your project", "My project"),
                HomeCard("Pick up your work", "Saved work"),
            },
        },
    }

    private func Appearance() Blob -> Container{
        Gap: 24,
        ui.Heading("Appearance"),
        Painting(HeroHeight()),
        ui.Check(
            "Oil-paint texture",
            oilPaint,
            value -> {
                oilPaint = value
            }
        ),
        ui.Check(
            "Animate theme changes",
            ui.Motion,
            value -> {
                ui.Motion = value
            }
        ),
    }

    private func Dialog() Blob -> ConfirmDialog{
        Open: app.Confirmation != nil,
        Title: app.ConfirmationTitle,
        Text: app.ConfirmationText,
        Content: app.ConfirmationContent?.Invoke(),
        ConfirmLabel: app.ConfirmationLabel,
        WindowWidth: ui.WindowWidth,
        Compact: ui.Compact(),
        Short: ui.Short(),
        KeyBindings: WidgetKeyBindings.Editing(app.Window?.PlatformInput),
        OnKeyDown: event -> ui.KeyNavigation(event),
        OnPointerDown: event -> ui.FocusHints(false),
        OnCancel: () -> {
            app.Confirmation = nil
            app.Refresh()
        },
        OnConfirm: () -> {
            let action = app.Confirmation
            app.Confirmation = nil
            action?.Invoke()
            app.Refresh()
        },
    }.Build()

    override func Build() Blob {
        ui.Twilight = twilight.Value
        ui.LoadingPulse = loadingPulse.Value
        ui.Busy = app.Busy
        ui.Loading = app.Busy && app.Visible && app.Page == app.ActivePage && !app.Streaming
        ui.Stopping = app.Stopping
        ui.ActionName = app.ActionName
        ui.ActivityTitle = app.Title
        ui.Apply()
        if let window = app.Window {
            window.Background = ui.Paper()
        }
        art.Effect.SetParameter(0, Vector4(float32(ui.Twilight), oilPaint ? 1.0F: 0.0F, 0.0F, 0.04F))
        art.Effect.Playing = false
        art.LandscapeEffect.SetParameter(0, Vector4(0.0F, oilPaint ? 1.0F: 0.0F, 0.0F, 0.04F))
        art.LandscapeEffect.Playing = false
        let content = switch app.Page {
            case "Donate": donor.Build()
            case "My project": owner.Build()
            case "Saved work": saved.Build()
            case "Appearance": Appearance()
            default: Home()
        }
        let welcome = app.Page == "Welcome"
        let donating = app.Page == "Donate" && donor.IsDonating
        let live = app.Page == "Donate" && donor.IsLive
        let browsing = switch app.Page {
            case "Donate": donor.IsBrowsing
            case "Saved work": saved.IsBrowsing
            case "My project": owner.IsBrowsing
            default: false
        }
        if browsing && !ui.Short() {
            content.FlexGrow = 1
            content.FlexShrink = 1
            content.FlexBasis = 0
            content.MinHeight = 0
        }
        let fill = !ui.Short() && (welcome || live || browsing)
        let body = PageFrame{
            Key: app.Page == "Donate" ? donor.Key: app.Page == "My project" ? owner.Key: app.Page,
            Handle: contentViewport,
            Fill: fill,
            Wide: welcome,
            Children: []Blob{content},
        }.Build()
        if app.Message != "" && !donating && app.Page != "Donate" {
            body.Children.Add(Notice{Message: app.Message}.Build())
        }
        if app.Report != "" && !donating && app.Page != "Donate" {
            body.Children.Add(ReportText{Content: app.Report}.Build())
        }
        let workspace = Container{
            Key: "workspace",
            FlexGrow: 1,
            FlexShrink: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            SectionBackground(),
            WindowBar.Mount(
                "chrome",
                WindowBarInput{
                    Host: app.Window,
                    Transparent: welcome,
                    Night: night,
                    OnToggleTheme: () -> ToggleTheme(),
                }
            ),
            Container{
                Key: "content-scroll",
                FlexGrow: 1,
                FlexShrink: 1,
                FlexBasis: 0,
                MinWidth: 0,
                MinHeight: 0,
                OverflowX: Overflow.Hidden,
                OverflowY: fill ? Overflow.Hidden: Overflow.Scroll,
                Padding: welcome ? 0: ui.Compact() ? 16: 28,
                body,
            },
        }
        if ui.Compact() {
            workspace.Children.Insert(2, Sidebar())
        }
        return AppFrame{
            Handle: viewport,
            Navigation: ui.Compact() ? nil: Sidebar(),
            Workspace: workspace,
            Overlay: app.Confirmation != nil ? Dialog(): nil,
            KeyBindings: WidgetKeyBindings.Editing(app.Window?.PlatformInput),
            OnKeyDown: event -> ui.KeyNavigation(event),
            OnPointerDown: event -> ui.FocusHints(false),
        }.Build()
    }
}
