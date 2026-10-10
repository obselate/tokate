package TokateDesktop

import Goo

/// A vertical group with uniform spacing. `Fill` makes it take its parent's full height.
data struct Stack {
    var Children []Blob
    var Gap float64
    var Fill bool

    func Build() Container {
        let stack = Container{Gap: Gap, Children: Children ?? []Blob{}}
        if Fill {
            stack.Height = Percent(100)
            stack.MinHeight = 0
        }
        return stack
    }
}
