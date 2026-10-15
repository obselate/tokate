package TokateDesktop

import Goo
import System
import System.Collections.Generic

/// Compact task rows with publication and saved-run actions.
data struct DonationTasks {
    var Tasks []DonationTask
    var ReviewEach bool
    var Button CommandButton
    var OnSaved Action[string]?

    func Build() Blob {
        let rows = List[Blob]()
        let saved = OnSaved
        for task in Tasks ?? []DonationTask{} {
            let ready = ReviewEach && task.Directory != "" && task.PullRequest == "" && task.Result != "failed" && task.Result != "skipped"
            let url = task.PullRequest
            let path = task.Directory
            rows.Add(Container{
                Padding: Edges{Left: AppTheme.Space16, Right: AppTheme.Space16, Top: AppTheme.Space12, Bottom: AppTheme.Space12},
                MinHeight: AppTheme.RowHeight,
                BorderWidth: Edges{Bottom: 1}, BorderColor: AppTheme.Current.Line,
                Gap: AppTheme.Space4,
                Children: []Blob{
                Row{Children: []Blob{
                    Container{Width: AppTheme.IssueNumberWidth, FlexShrink: 0, Label{Content: task.Issue == "" ? "Task": "#" + task.Issue}.Build()},
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: AppTheme.ShortFieldWidth, Label{Content: ready ? "Ready to submit": task.Result}.Build()},
                    url != "" ? (Button with{Label = "Pull request", Name = "Open pull request " + task.Issue, Kind = ButtonKind.Quiet, OnClick = () -> Browser.Open(url)}).Build(): Container{},
                    path != "" ? (Button with{Label = ready ? "Review": "Saved run", Name = "Open saved run " + task.Issue, Kind = ButtonKind.Quiet, OnClick = () -> saved?.Invoke(path)}).Build(): Container{},
                }}.Build(),
                task.Reason != "" ? Label{Content: task.Reason, Muted: true, Size: AppTheme.SmallSize}.Build(): Container{},
                },
            })
        }
        if rows.Count == 0 { rows.Add(Label{Content: "No tasks completed.", Muted: true}.Build()) }
        return Container{BackgroundColor: AppTheme.Current.Surface, BorderRadius: AppTheme.PanelRadius, Children: rows.ToArray()}
    }
}
