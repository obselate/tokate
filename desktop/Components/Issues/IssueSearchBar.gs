package TokateDesktop

import Goo
import System

/// The issue query field and search button, optional approval filters, and a notice when results are capped.
/// Buttons derive from `Button`.
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
        let body = Stack{Gap: 12}.Build()
        body.Children.Add(
            Row{
                Children: []Blob{
                    InputField{
                        Label: "Search issues",
                        Value: Listing.Query,
                        OnChange: OnQuery,
                        Placeholder: "Title keywords or #number",
                        Width: 480,
                        OnSubmit: search,
                        Disabled: Disabled,
                    }.Build(),
                    (Button with{Label = "Search issues", OnClick = search, Primary = true}).Build(),
                },
                Align: AlignItems.FlexEnd,
            }.Build()
        )
        if ShowFilters {
            let filters = []IssueFilter{IssueFilter.All, IssueFilter.Approved, IssueFilter.NeedsApproval}
            let labels = []string{
                IssueListing.FilterLabel(IssueFilter.All),
                IssueListing.FilterLabel(IssueFilter.Approved),
                IssueListing.FilterLabel(IssueFilter.NeedsApproval),
            }
            body.Children.Add(
                PresetGroup{
                    Button: Button,
                    Labels: labels,
                    Selected: Array.IndexOf(filters, Listing.Filter),
                    OnChoose: index -> filter?.Invoke(filters[index]),
                }.Build()
            )
        }
        if Listing.Truncated {
            body.Children.Add(Label{Content: "Refine your search to see all matching issues.", Size: 17}.Build())
        }
        return body
    }
}
