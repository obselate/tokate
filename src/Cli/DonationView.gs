package Tokate

import Gsharp.Concurrency
import Spectre.Console
import Spectre.Console.Rendering
import System
import System.Collections.Generic
import System.Globalization
import System.Runtime.InteropServices
import System.Text

internal class DonationView {
    private let Gate Object = Object()
    private let Stop Chan[bool] = Chan[bool](1)
    private let Finished Chan[bool] = Chan[bool](1)
    private let Transcript List[string] = List[string]()
    private var Footer string = "Starting donation..."
    private var Dirty bool = true
    private var Redraw bool = true
    private var Scroll int32
    private var Width int32
    private var Height int32
    private var Previous[]string = []string{}
    private let Content List[string] = List[string]()
    private var ContentDirty bool = true

    private func Draw() {
        let width = Math.Max(1, Console.WindowWidth)
        let height = Math.Max(1, Console.WindowHeight)
        let full = Redraw || width != Width || height != Height

        if !Dirty && !full {
            return
        }

        Width = width
        Height = height
        Redraw = false
        Dirty = false

        let rows = List[string]()
        let page = Math.Max(1, height - 4)

        if ContentDirty || full {
            let previousCount = Content.Count

            Content.Clear()

            for line in Transcript {
                var remaining = line

                if remaining == "" {
                    Content.Add("")
                }

                while remaining != "" {
                    var part = Clip(remaining, Math.Max(1, width - 1))

                    if part.Length < remaining.Length && !Char.IsWhiteSpace(remaining[part.Length]) {
                        let boundary = part.LastIndexOf(' ')

                        if boundary > 0 {
                            part = part.Substring(0, boundary)
                        }
                    }

                    if part == "" {
                        break
                    }

                    Content.Add(part)
                    remaining = remaining.Substring(part.Length).TrimStart()
                }
            }

            if Scroll > 0 && ContentDirty {
                Scroll += Math.Max(0, Content.Count - previousCount)
            }

            ContentDirty = false
        }

        Scroll = Math.Clamp(Scroll, 0, Math.Max(0, Content.Count - page))

        let start = Math.Max(0, Content.Count - page - Scroll)

        rows.Add(Color("gold") + Clip("tokate / Donation", width - 1))

        for i in 0 ... page {
            rows.Add(Color("ink") + (start + i < Content.Count ? Content[start + i]: ""))
        }

        rows.Add(Color("muted") + Clip("PgUp/PgDn scroll   End follow   Ctrl+C stop", width - 1))
        rows.Add(Color("sage") + Clip(Footer, width - 1))

        let output = StringBuilder(full ? Color("paper") + "\x1b[H\x1b[2J": "")

        for i in 0 ... Math.Min(height, rows.Count) {
            let row = rows[i]

            if full || i >= Previous.Length || row != Previous[i] {
                output.Append("\x1b[" + (i + 1).ToString() + ";1H" + Color("paper") + Color("ink") + row + "\x1b[K")
            }
        }

        if output.Length > 0 {
            Console.Error.Write(output.Append("\x1b[" + height.ToString() + ";1H").ToString())
        }

        Previous = rows.ToArray()
    }

    private func Update() {
        try {
            using let resumed = PosixSignalRegistration.Create(
                PosixSignal.SIGCONT,
                context -> {
                    lock Gate {
                        Redraw = true
                    }
                }
            )

            while true {
                lock Gate {
                    while Console.KeyAvailable {
                        let key = Console.ReadKey(true)

                        if key.Key == ConsoleKey.PageUp {
                            Scroll += Math.Max(1, Height - 4)
                        } else if key.Key == ConsoleKey.PageDown {
                            Scroll = Math.Max(0, Scroll - Math.Max(1, Height - 4))
                        } else if key.Key == ConsoleKey.End {
                            Scroll = 0
                        } else if key.Key == ConsoleKey.L && (key.Modifiers & ConsoleModifiers.Control) != 0 {
                            Redraw = true
                        }

                        Dirty = true
                    }

                    Draw()
                }

                using let tick = after(TimeSpan.FromMilliseconds(100))

                select {
                    case <- Stop {
                        return
                    }

                    case <- tick { }
                }
            }
        } catch (error Exception) { } finally {
            Finished <- true
        }
    }

    shared {
        private var Current DonationView?

        private func Available() bool -> !PublicOutput.Enabled &&
            !Console.IsInputRedirected &&
            !Console.IsOutputRedirected &&
            !Console.IsErrorRedirected &&
            !Terminal.Plain &&
            Environment.GetEnvironmentVariable("TERM") != "dumb"

        private func Color(name string) string {
            if Terminal.Plain || Environment.GetEnvironmentVariable("NO_COLOR") != nil ||
                Environment.GetEnvironmentVariable("TERM") == "dumb" {
                return ""
            }

            let rich = Terminal.Output(true).Profile.Supports(ColorSystem.TrueColor)
            let code = switch name {
                case "gold": rich ? "38;2;226;187;128": "93"
                case "sage": rich ? "38;2;176;191;166": "92"
                case "muted": rich ? "38;2;193;198;203": "37"
                case "paper": rich ? "48;2;35;50;75": "44"
                default: rich ? "38;2;238;229;207": "97"
            }

            return "\x1b[" + code + "m"
        }

        private func Clip(value string, width int32) string {
            let text = StringBuilder()
            let measurement = RenderOptions(Terminal.Output(true).Profile.Capabilities, Size(int32.MaxValue, 1))
            let elements = StringInfo.GetTextElementEnumerator(value)
            var used int32

            while elements.MoveNext() {
                let item = elements.GetTextElement()
                let rendered IRenderable = Text(item)
                let cells = rendered.Measure(measurement, int32.MaxValue).Max

                if used + cells > width {
                    break
                }

                text.Append(item)
                used += cells
            }

            return text.ToString()
        }

        internal func Active() bool -> Current != nil

        internal func Start() bool {
            if Donate.Active || !Available() {
                return false
            }

            if Current == nil {
                Console.Error.Write("\x1b[?1049h")

                let view = DonationView()

                Current = view
                go view.Update()
            }

            return true
        }

        internal func Append(text string) {
            if let view = Current {
                let safe = Tokate.Output.Clean(text)

                lock view.Gate {
                    for line in safe.Split('\n') {
                        view.Transcript.Add(line.Substring(0, Math.Min(line.Length, 4096)))
                    }

                    if view.Transcript.Count > 500 {
                        view.Transcript.RemoveRange(0, view.Transcript.Count - 500)
                    }

                    view.Dirty = true
                    view.ContentDirty = true
                }
            }
        }

        internal func Status(text string) {
            if let view = Current {
                lock view.Gate {
                    view.Footer = Tokate.Output.Clean(text)
                    view.Dirty = true
                }
            }
        }

        internal func Close() {
            if let view = Current {
                view.Stop <- true
                <-view.Finished
                lock view.Gate {
                    view.Draw()
                }

                Current = nil
                Console.Error.Write("\x1b[0m\x1b[?1049l")
            }
        }
    }
}
