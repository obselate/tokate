package TokateDesktop

import Goo

class AppearanceView {
    private let app DesktopApp

    init(app DesktopApp) {
        this.app = app
    }

    func Build() Blob {
        let settings = app.Theme.Settings
        let busy = app.Activity.Busy
        return Stack{
            Gap: 24,
            Children: []Blob{
                Heading{Content: "Appearance"}.Build(),
                Painting.Mount(app, app.Window.Metrics.ContentWidth * 0.4, true),
                Check{
                    Label: "Oil-paint texture",
                    Value: settings.OilPaint,
                    OnChange: value -> app.Theme.SetOilPaint(value),
                    Disabled: busy,
                }.Build(),
                Check{
                    Label: "Animate theme changes",
                    Value: settings.Motion,
                    OnChange: value -> app.Theme.SetMotion(value),
                    Disabled: busy,
                }.Build(),
            },
        }.Build()
    }
}
