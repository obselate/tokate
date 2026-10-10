package TokateDesktop

import Goo
import System

class WelcomeView {
    private let app DesktopApp
    private let navigate Action[Destination]

    init(app DesktopApp, navigate Action[Destination]) {
        this.app = app
        this.navigate = navigate
    }

    func Build() Blob {
        let metrics = app.Window.Metrics
        let compact = metrics.ContentWidth < 900
        return Showcase{
            Art: Painting.Mount(app, metrics.Short ? 160: 0, false),
            Children: []Blob{
                HeroTitle{Width: metrics.ContentWidth, Title: "Give your inference", Accent: "a purpose."}.Build(),
                Row{
                    Children: []Blob{
                        Choice("Donate AI time", Destination.Donate, compact),
                        Choice("Open your project", Destination.Project, compact),
                        Choice("Pick up your work", Destination.Saved, compact),
                    },
                    Gap: compact ? 12: 24,
                    Align: AlignItems.Stretch,
                    Justify: JustifyContent.Center,
                    NoWrap: true,
                }.Build(),
            },
            Short: metrics.Short,
        }.Build()
    }

    private func Choice(title string, target Destination, compact bool) Blob -> StoneCard{
        Title: title,
        Stone: app.Art.Stone,
        Compact: compact,
        OnClick: () -> navigate(target),
    }.Build()
}
