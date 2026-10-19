package TokateDesktop

import Goo
import System

/// The theme of the app, with the painting as its preview, and the paint texture and motion preferences.
class AppearanceView {
    private let app DesktopApp

    init(app DesktopApp) {
        this.app = app
    }

    func Build(page PageContext) Blob {
        let settings = app.Theme.Settings
        let busy = app.Activity.Busy
        return page.Layout(
            Heading{Content: "Appearance", Size: AppTheme.DisplaySize}.Build(),
            []Blob{
                Painting.Mount(app, Math.Min(app.Window.Metrics.ContentWidth * 0.4, app.Window.Metrics.WindowHeight * 0.3), true),
                Panel{
                    Children: []Blob{
                        IconHeading{Icon: "palette", Content: "Theme"}.Build(),
                        Row{
                            Children: []Blob{
                                Theme("Daylight", "Light colors", "light_mode", false, settings.Night, busy),
                                Theme("Moonlight", "Dark colors", "dark_mode", true, settings.Night, busy),
                            },
                        }.Build(),
                        Rule{}.Build(),
                        Check{
                            Label: "Oil-paint texture",
                            Detail: "Shows brush strokes on the paintings",
                            Value: settings.OilPaint,
                            OnChange: value -> app.Theme.SetOilPaint(value),
                            Disabled: busy,
                        }.Build(),
                        Check{
                            Label: "Animations",
                            Detail: "Animate theme changes and loading states",
                            Value: settings.Motion,
                            OnChange: value -> app.Theme.SetMotion(value),
                            Disabled: busy,
                        }.Build(),
                    },
                }.Build(),
            }
        )
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
