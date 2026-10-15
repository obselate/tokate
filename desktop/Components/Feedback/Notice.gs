package TokateDesktop

import Goo

/// A short message about the latest action. Zero size resolves to 16; notices are muted unless `Plain`.
data struct Notice {
    var Message string
    var Size float64
    var Plain bool

    func Build() Text -> Label{Content: Message, Size: Size == 0 ? AppTheme.LabelSize: Size, Muted: !Plain}.Build()
}
