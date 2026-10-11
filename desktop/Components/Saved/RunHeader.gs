package TokateDesktop

import Goo
import System

/// The title of a selected saved run: the issue title and status above the repository and the links to
/// GitHub.
data struct RunHeader {
    var Item SavedRun
    var Button CommandButton
    var OnOpenIssue Action?
    var OnOpenPullRequest Action?

    func Build() Blob {
        let run = Item.Run ?? Run.Empty
        let links = Row{
            Gap: 4,
            Children: []Blob{
                Label{Content: Item.Title == "" ? "": run.Identity, Size: AppTheme.SmallSize, Muted: true}.Build(),
                (Button with{
                    Label = "Open issue",
                    Kind = ButtonKind.Quiet,
                    Icon = "open_in_new",
                    AllowWhileBusy = true,
                    OnClick = OnOpenIssue,
                }).Build(),
            },
        }.Build()
        if run.Pr > 0 {
            links.Children.Add(
                (Button with{
                    Label = "Open pull request",
                    Kind = ButtonKind.Quiet,
                    Icon = "open_in_new",
                    AllowWhileBusy = true,
                    OnClick = OnOpenPullRequest,
                }).Build()
            )
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.FlexStart,
            Gap: 16,
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Gap: 2,
                Heading{Content: Item.Title == "" ? run.Identity: Item.Title, Size: AppTheme.DisplaySize, MaxLines: 2}.Build(),
                links,
            },
            Container{Padding: Edges{Top: 8}, StatusBadge{Value: Item.Status(), Tone: Statuses.ToneOf(Item.Status())}.Build()},
        }
    }
}
