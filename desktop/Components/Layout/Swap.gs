package TokateDesktop

import Goo

/// A vertical group that is replaced as a whole when `Key` changes, so that no state continues from the
/// group before it. `Fill` gives the group the remaining height of its parent.
data struct Swap {
    var Key string
    var Children []Blob
    var Gap float64
    var Fill bool

    func Build() Container {
        let group = Container{Key: Key, Gap: Gap, Children: Children ?? []Blob{}}
        let slot = Container{Children: []Blob{group}}
        if Fill {
            for part in []Container{slot, group} {
                part.FlexGrow = 1
                part.FlexShrink = 1
                part.FlexBasis = 0
                part.MinHeight = 0
            }
        }
        return slot
    }
}
