package TokateDesktop

import Goo

/// A one-pixel horizontal divider with optional space below it.
data struct Rule {
    var Spacing float64

    func Build() Container {
        let line = Container{Height: 1, FlexShrink: 0, BackgroundColor: AppTheme.Current.Line}
        if Spacing > 0 {
            line.Margin = Edges{Bottom: Spacing}
        }
        return line
    }
}
