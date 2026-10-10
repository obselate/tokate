package TokateDesktop

import Goo
import System

data struct Palette {
    var Paper Color
    var Surface Color
    var Ink Color
    var Muted Color
    var Accent Color
    var Line Color
    var ChromeHover Color
    var CloseHover Color
}

class AppTheme {
    shared {
        let Daylight Palette = Palette{
            Paper: Color.Parse("#F3E7D4"),
            Surface: Color.Parse("#FFF8EB"),
            Ink: Color.Parse("#303B2B"),
            Muted: Color.Parse("#625D4E"),
            Accent: Color.Parse("#97492E"),
            Line: Color.Parse("#D7CCB7"),
            ChromeHover: Color.Parse("#E4D4B8"),
            CloseHover: Color.Parse("#97492E"),
        }
        let Moonlight Palette = Palette{
            Paper: Color.Parse("#23324B"),
            Surface: Color.Parse("#2A3B53"),
            Ink: Color.Parse("#EEE5CF"),
            Muted: Color.Parse("#C1C6CB"),
            Accent: Color.Parse("#E2BB80"),
            Line: Color.Parse("#526076"),
            ChromeHover: Color.Parse("#35485F"),
            CloseHover: Color.Parse("#AA563A"),
        }
        let BodyFont string = "Newsreader"
        let HeadingFont string = "Cormorant"
        let MonoFont string = "monospace"
        let StoneInk Color = Color.Parse("#303B2B")
        let CloseInk Color = Color.Parse("#FFF8EB")
        let WindowBackground Color = Color.Parse("#F3E7D4")

        var Current Palette = Daylight
        var Twilight float64
        var FocusVisible bool
        var Motion bool = true

        func Blend(day Palette, night Palette, t float64) Palette -> Palette{
            Paper: Mix(day.Paper, night.Paper, t),
            Surface: Mix(day.Surface, night.Surface, t),
            Ink: Mix(day.Ink, night.Ink, t),
            Muted: Mix(day.Muted, night.Muted, t),
            Accent: Mix(day.Accent, night.Accent, t),
            Line: Mix(day.Line, night.Line, t),
            ChromeHover: Mix(day.ChromeHover, night.ChromeHover, t),
            CloseHover: Mix(day.CloseHover, night.CloseHover, t),
        }

        func Mix(day Color, night Color, amount float64) Color {
            let t = float32(amount)
            return Color.FromNormalized(
                day.R + (night.R - day.R) * t,
                day.G + (night.G - day.G) * t,
                day.B + (night.B - day.B) * t,
                1.0F
            )
        }

        func Apply(twilight float64) {
            Twilight = twilight
            Current = Blend(Daylight, Moonlight, twilight)
        }

        func FocusStyle() Style -> FocusVisible ? Style{OutlineWidth: 2, OutlineColor: Current.Accent, OutlineOffset: 2}: Style{}
    }
}
