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
    var Ok Color
    var Fail Color
}

/// The group of a status or message, by who must act next.
enum Tone {
    Need,
    Wait,
    Done,
    Fail
}

/// The colors and icon that show a tone. Tones without an icon have an empty name.
data struct ToneLook {
    var Fill Color
    var Ink Color
    var Line Color
    var Edge Color
    var Icon string
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
            Ok: Color.Parse("#4F6B3A"),
            Fail: Color.Parse("#8E2F3C"),
        }
        let Moonlight Palette = Palette{
            Paper: Color.Parse("#23324B"),
            Surface: Color.Parse("#2A3B53"),
            Ink: Color.Parse("#EEE5CF"),
            Muted: Color.Parse("#C1C6CB"),
            Accent: Color.Parse("#E2BB80"),
            Line: Color.Parse("#526076"),
            ChromeHover: Color.Parse("#35485F"),
            Ok: Color.Parse("#A9C08A"),
            Fail: Color.Parse("#EFA08F"),
        }
        let BodyFont string = "Newsreader"
        let HeadingFont string = "Cormorant"
        let MonoFont string = "monospace"
        let StoneInk Color = Color.Parse("#303B2B")
        let DisplaySize float64 = 38
        let TitleSize float64 = 28
        let ItemSize float64 = 22
        let BodySize float64 = 18
        let SmallSize float64 = 16
        let CodeSize float64 = 14
        let ControlRadius float64 = 5
        let PanelRadius float64 = 8
        let Space4 float64 = 4
        let Space8 float64 = 8
        let Space12 float64 = 12
        let Space16 float64 = 16
        let Space24 float64 = 24
        let Space32 float64 = 32
        let ContentMax float64 = 1050
        let PageGutter float64 = Space24
        let ColumnGap float64 = Space24
        let ColumnMin float64 = 320
        let ColumnsBreakpoint float64 = 740
        let NarrowBreakpoint float64 = 540
        let CardPadding float64 = Space24
        let SectionGap float64 = Space24
        let ButtonHeight float64 = 44
        let ButtonMinWidth float64 = 96
        let QuietMinWidth float64 = 64
        let CompactButtonHeight float64 = 36
        let CompactButtonMinWidth float64 = 64
        let FieldHeight float64 = 44
        let FieldWidth float64 = 400
        let ShortFieldWidth float64 = 192
        let WideFieldWidth float64 = 540
        let LabelSize float64 = 16
        let RowHeight float64 = Space32 * 2
        let RailWidth float64 = 224
        let NarrowRailWidth float64 = 200
        let ChoiceMinWidth float64 = 224
        let CompactChoiceMinWidth float64 = 160
        let DetailLabelWidth float64 = 120
        let IssueNumberWidth float64 = 56
        let ReportMaxHeight float64 = 320
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
            Ok: Mix(day.Ok, night.Ok, t),
            Fail: Mix(day.Fail, night.Fail, t),
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

        func Look(tone Tone) ToneLook -> switch tone {
            case Tone.Wait: ToneLook{
                Fill: Current.Surface,
                Ink: Current.Muted,
                Line: Current.Line,
                Edge: Current.Muted,
                Icon: "hourglass_top",
            }
            case Tone.Done: ToneLook{
                Fill: Mix(Current.Surface, Current.Ok, 0.16),
                Ink: Current.Ok,
                Line: Color.Transparent,
                Edge: Current.Ok,
                Icon: "task_alt",
            }
            case Tone.Fail: ToneLook{
                Fill: Mix(Current.Surface, Current.Fail, 0.14),
                Ink: Current.Fail,
                Line: Color.Transparent,
                Edge: Current.Fail,
                Icon: "error",
            }
            default: ToneLook{
                Fill: Current.Accent,
                Ink: Current.Surface,
                Line: Color.Transparent,
                Edge: Current.Accent,
                Icon: "",
            }
        }

        func FocusStyle() Style -> FocusVisible ? Style{OutlineWidth: 2, OutlineColor: Current.Accent, OutlineOffset: 2}: Style{}
    }
}
