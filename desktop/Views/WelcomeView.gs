package TokateDesktop

import Goo
import System

class WelcomeView {
    private let app DesktopApp
    private let navigate Action[Destination]
    private let resume Action[string]

    init(app DesktopApp, navigate Action[Destination], resume Action[string]) {
        this.app = app
        this.navigate = navigate
        this.resume = resume
    }

    func Build(page PageContext) Blob {
        let metrics = app.Window.Metrics
        let compact = metrics.ContentWidth < 900
        let state = app.Welcome.Current
        return Showcase{
            Art: Painting.Mount(app, metrics.Short ? 160: 0, false),
            Children: []Blob{
                page.Layout(HeroTitle{Width: metrics.ContentWidth, Title: "Give your inference", Accent: "a purpose."}.Build(), []Blob{
                Overhang{
                    Content: Row{
                        Children: []Blob{
                            Choice("Donate AI time", Destination.Donate, compact),
                            Choice("Open your project", Destination.Project, compact),
                            Choice("Pick up your work", Destination.Saved, compact),
                        },
                        Gap: compact ? AppTheme.Space12: AppTheme.Space24,
                        Align: AlignItems.Stretch,
                        Justify: JustifyContent.Center,
                        NoWrap: true,
                    }.Build(),
                    Above: state.Latest != nil ? Continue(state.Latest!!): nil,
                }.Build(),
                }),
            },
            Overlay: state.SignedOut ? SignIn(): nil,
            Short: metrics.Short,
        }.Build()
    }

    /// The link to the most recent contribution.
    private func Continue(latest SavedRun) Blob -> PaintedLink{
        Label: "Continue " + latest.Identity(0),
        Detail: latest.Age(DateTime.UtcNow),
        Ink: AppTheme.Current.Accent,
        DetailInk: AppTheme.Current.Muted,
        OnClick: () -> resume(latest.Path),
    }.Build()

    private func SignIn() Blob -> StonePlaque{
        Title: "GitHub CLI is not signed in",
        Detail: "In a terminal, run",
        Command: "gh auth login",
        Action: "Check again",
        Stone: app.Art.Stone,
        OnAction: () -> app.Welcome.Refresh(app.Saved.Current.RunPath),
    }.Build()

    private func Choice(title string, target Destination, compact bool) Blob -> StoneCard{
        Title: title,
        Stone: app.Art.Stone,
        Compact: compact,
        OnClick: () -> navigate(target),
    }.Build()
}
