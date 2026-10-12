package TokateDesktop

import Goo
import System

/// The theme of the app, with the painting as its preview, and the paint texture and motion preferences.
class AppearanceView {
    private let app DesktopApp

    init(app DesktopApp) {
        this.app = app
    }

    func Build() Blob {
        let settings = app.Theme.Settings
        let busy = app.Activity.Busy
        let compact = app.Window.Metrics.ContentWidth < 650
        return Stack{
            Gap: 20,
            Children: []Blob{
                Heading{Content: "Appearance", Size: AppTheme.DisplaySize}.Build(),
                Painting.Mount(app, Math.Min(app.Window.Metrics.ContentWidth * 0.4, app.Window.Metrics.WindowHeight * 0.34), true),
                Panel{
                    Compact: compact,
                    Children: []Blob{
                        IconHeading{Icon: "palette", Content: "Theme"}.Build(),
                        Row{
                            Children: []Blob{
                                Theme("Daylight", "The fresco under the sun.", "light_mode", false, settings.Night, busy),
                                Theme("Moonlight", "The fresco at night.", "dark_mode", true, settings.Night, busy),
                            },
                        }.Build(),
                        Rule{}.Build(),
                        Check{
                            Label: "Oil-paint texture",
                            Detail: "Shows brush strokes on the paintings.",
                            Value: settings.OilPaint,
                            OnChange: value -> app.Theme.SetOilPaint(value),
                            Disabled: busy,
                        }.Build(),
                        Check{
                            Label: "Animations",
                            Detail: "Moves between themes, tabs and loading states with motion.",
                            Value: settings.Motion,
                            OnChange: value -> app.Theme.SetMotion(value),
                            Disabled: busy,
                        }.Build(),
                    },
                }.Build(),
            },
        }.Build()
    }

    private func Theme(title string, detail string, icon string, night bool, current bool, busy bool) Blob -> ChoiceCard{
        Title: title,
        Detail: detail,
        Icon: icon,
        Selected: night == current,
        OnChoose: () -> {
            if night != current {
                app.Theme.Toggle()
            }
        },
        Disabled: busy,
    }.Build()
}
