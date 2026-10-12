package TokateDesktop

import Goo
import System

/// Page controls for an issue listing, or their space before the first search ends. GitHub search returns at
/// most 1000 results.
data struct IssuePager {
    var Listing IssueListing
    var Button CommandButton
    var Narrow bool
    var OnPage Action[int32]?

    func Build() Blob -> !Listing.Loaded ? Container{FlexShrink: 0, MinHeight: 44}: Pager{
        Button: Button,
        Page: Listing.Page,
        LastPage: IssueListing.LastPage(Listing.VisibleTotal),
        Summary: Listing.Total == 1 ? "1 issue": Listing.Total.ToString() + " issues",
        Narrow: Narrow,
        OnChange: OnPage,
    }.Build()
}
