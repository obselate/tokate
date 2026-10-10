package TokateDesktop

import Goo

/// A vertical group with uniform spacing.
data struct Stack {
    var Children []Blob
    var Gap float64

    func Build() Container -> Container{Gap: Gap, Children: Children ?? []Blob{}}
}
