package TokateDesktop

import Goo

class Painting {
    shared {
        /// The hands-and-sky painting in the current light. Zero height fills the remaining space.
        func Mount(app DesktopApp, height float64, background bool) Blob -> Fresco.Mount(
            "fresco",
            FrescoInput{
                Backdrop: app.Art.Backdrop,
                Sun: app.Art.Sun,
                Moon: app.Art.Moon,
                Hands: app.Art.Hands,
                Effect: app.Art.Effect,
                Night: app.Theme.Twilight,
                Height: height,
                Background: background,
            }
        )
    }
}
