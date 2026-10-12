package TokateDesktop

import Goo
import System

/// The issue query field with its search button, after optional approval filters on the same row, and a
/// notice when results are capped. Buttons derive from `Button`.
data struct IssueSearchBar {
    var Listing IssueListing
    var Button CommandButton
    var Disabled bool
    var ShowFilters bool
    var OnQuery Action[string]?
    var OnSearch Action?
    var OnFilter Action[IssueFilter]?

    func Build() Blob {
        let search = OnSearch
        let filter = OnFilter
        let bar = Row{Children: []Blob{}}.Build()
        if ShowFilters {
            let filters = []IssueFilter{IssueFilter.All, IssueFilter.NeedsApproval, IssueFilter.Approved}
            let labels = []string{
                IssueListing.FilterLabel(IssueFilter.All),
                IssueListing.FilterLabel(IssueFilter.NeedsApproval),
                IssueListing.FilterLabel(IssueFilter.Approved),
            }
            bar.Children.Add(
                PresetGroup{
                    Button: Button,
                    Labels: labels,
                    Selected: Array.IndexOf(filters, Listing.Filter),
                    OnChoose: index -> filter?.Invoke(filters[index]),
                }.Build()
            )
            bar.Children.Add(Spacer{}.Build())
        }
        bar.Children.Add(
            Row{
                NoWrap: true,
                Children: []Blob{
                    InputField{
                        Label: "Search issues",
                        Bare: true,
                        Value: Listing.Query,
                        OnChange: OnQuery,
                        Placeholder: "Title keywords or #number",
                        Width: 320,
                        OnSubmit: search,
                        Disabled: Disabled,
                    }.Build(),
                    (Button with{Label = "Search issues", Kind = ButtonKind.Icon, Icon = "search", OnClick = search}).Build(),
                },
            }.Build()
        )
        let body = Stack{Gap: 12, Children: []Blob{bar}}.Build()
        if Listing.Truncated {
            body.Children.Add(Label{Content: "Refine your search to see all matching issues.", Size: AppTheme.SmallSize}.Build())
        }
        return body
    }
}
