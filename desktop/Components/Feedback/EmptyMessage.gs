package TokateDesktop

import Goo
import Goo.Widgets.Icons

/// The placeholder shown when a list has no rows: an icon above the message.
data struct EmptyMessage {
    var Content string
    var Icon string

    func Build() Blob {
        let message = Label{Content: Content, Size: AppTheme.ItemSize, Muted: true}.Build()
        message.TextAlign = TextAlign.Center
        return Container{
            FlexGrow: 1,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Gap: AppTheme.Space12,
            Padding: AppTheme.Space24,
            MaterialIcons.Create(Icon, 40, AppTheme.Current.Muted),
            message,
        }
    }
}
