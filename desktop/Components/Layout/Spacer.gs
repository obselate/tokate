package TokateDesktop

import Goo

/// Flexible space that pushes following siblings to the end of a row or column.
data struct Spacer {
    func Build() Container -> Container{FlexGrow: 1}
}
