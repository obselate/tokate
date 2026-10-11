package TokateDesktop

import Goo

/// The placeholder shown when a list has no rows.
data struct EmptyMessage {
    var Content string

    func Build() Text -> Label{Content: Content, Size: AppTheme.ItemSize}.Build()
}
