package TokateDesktop

import Goo
import System

/// Page controls for an issue listing. GitHub search returns at most 1000 results.
data struct IssuePager {
    var Listing IssueListing
    var Button CommandButton
    var Narrow bool
    var OnPage Action[int32]?

    func Build() Blob -> Pager{
        Button: Button,
        Page: Listing.Page,
        LastPage: IssueListing.LastPage(Listing.VisibleTotal),
        Summary: Listing.Total.ToString() + " issues",
        Narrow: Narrow,
        OnChange: OnPage,
    }.Build()
}
