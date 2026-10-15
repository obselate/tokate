package Tokate

import Gsharp.Concurrency
import Spectre.Console
import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class TerminalProgress : IDisposable {
    private let Stop Chan[bool] = Chan[bool](1)
    private let Finished Chan[bool] = Chan[bool](1)
    private let Phase string
    private let Budget RuntimeBudget
    private let Total RuntimeBudget?
    private let Interactive bool
    private let Live bool

    internal init(phase string, budget RuntimeBudget, total RuntimeBudget? = nil) {
        Phase = Terminal.Clean(phase).Replace('\n', ' ')
        Budget = budget
        Total = total
        Live = DonationView.Start()
        Interactive = !Live && Terminal.Rich(true) && Terminal.Width(true) >= 80
        Draw()
        go Update()
    }

    private func Draw() {
        let value = Phase + ": " + Budget.Status() + (Total == nil ? "": "; total " + (Total?.Left() ?? "") + " left")

        if Live {
            DonationView.Status(value)
        } else if Interactive {
            let width = Terminal.Width(true) - 1

            Console.Error.Write("\r\x1b[2K" + value.Substring(0, Math.Min(width, value.Length)))
        } else {
            Terminal.Message(value, "cyan", true)
        }
    }

    private func Update() {
        try {
            let interval int32 = Live ? 1: 5

            while true {
                using let tick = after(TimeSpan.FromSeconds(interval))

                select {
                    case <- Stop {
                        return
                    }

                    case <- tick {
                        Draw()
                    }
                }
            }
        } catch (error Exception) { } finally {
            Finished <- true
        }
    }

    public func Dispose() {
        Stop <- true
        <-Finished

        if Interactive {
            Console.Error.Write("\r\x1b[2K")
        }
    }
}

internal class Terminal {
    shared {
        internal var Plain bool
        internal var Ascii bool
        private let Parchment string = "#f3e7d4"
        private let Gold string = "#89723f"
        private let Sage string = "#697459"
        private let Terracotta string = "#97492e"
        private let Blue string = "#50688e"

        internal func Initialize() {
            let term = Environment.GetEnvironmentVariable("TERM")

            try {
                Environment.SetEnvironmentVariable("TERM", "dumb")
                Console.WindowWidth.ToString()
            } finally {
                Environment.SetEnvironmentVariable("TERM", term)
            }
        }

        internal func Clean(value string) string {
            let stripped = Regex.Replace(
                value,
                "(?:\\x1b\\[|\\x9b)[0-?]*[ -/]*[@-~]|(?:\\x1b\\]|\\x9d)[^\\x07\\x1b\\x9c]*(?:\\x07|\\x1b\\\\|\\x9c)|\\x1b[@-_]",
                ""
            )

            let text = StringBuilder()

            for c in stripped {
                if c == '\t' {
                    text.Append("    ")
                } else if c == '\n' || (!Char.IsControl(c) && Char.GetUnicodeCategory(c) != UnicodeCategory.Format) {
                    text.Append(c)
                }
            }

            return text.ToString()
        }

        internal func Rich(error bool = false) bool -> !PublicOutput.Enabled &&
            !Plain &&
            !(error ? Console.IsErrorRedirected: Console.IsOutputRedirected) &&
            Environment.GetEnvironmentVariable("NO_COLOR") == nil && Environment.GetEnvironmentVariable(
            "TERM"
        ) != "dumb"

        internal func Output(error bool = false) IAnsiConsole -> AnsiConsole.Create(
            AnsiConsoleSettings{
                Out: AnsiConsoleOutput(error ? Console.Error: Console.Out),
                Ansi: Rich(error) ? AnsiSupport.Yes: AnsiSupport.No,
                ColorSystem: Depth(),
                Interactive: InteractionSupport.No,
            }
        )

        private func Depth() ColorSystemSupport {
            let color = Environment.GetEnvironmentVariable("COLORTERM") ?? ""
            let term = Environment.GetEnvironmentVariable("TERM") ?? ""
            if color == "truecolor" || color == "24bit" || term.Contains("direct") || term.Contains("truecolor") {
                return ColorSystemSupport.TrueColor
            }

            return term.Contains("256color") ? ColorSystemSupport.EightBit: ColorSystemSupport.Legacy
        }

        internal func Width(error bool = false) int32 {
            if error ? Console.IsErrorRedirected: Console.IsOutputRedirected {
                return 80
            }

            return Math.Max(20, Output(error).Profile.Width)
        }

        private func Accent(color string) string {
            let background = Environment.GetEnvironmentVariable("COLORFGBG") ?? ""
            let dark = background.EndsWith(";0") || background.EndsWith(";8")

            return switch color {
                case "green": dark ? "#b0bfa6": Sage

                case "red": dark ? "#d99a7d": Terracotta

                case "yellow": dark ? "#e2bb80": Gold

                case "cyan": dark ? "#a9bdd9": Blue
                default: "default"
            }
        }

        internal func Line(value string, color string, error bool) {
            if Rich(error) {
                let console = Output(error)

                console.Profile.Width = Math.Max(console.Profile.Width, value.Length + 1)

                let split = value.IndexOf(' ', value.Length - value.TrimStart().Length)
                let length = split < 0 ? value.Length: split

                console.Write(
                    value.Substring(0, length),
                    Style.Parse((value.EndsWith(":") ? "bold ": "") + Accent(color))
                )
                console.WriteLine(value.Substring(length))
            } else if error {
                Console.Error.WriteLine(value)
            } else {
                Console.WriteLine(value)
            }
        }

        internal func Message(text string, color string = "green", error bool = false) {
            if DonationView.Active() {
                DonationView.Append(text)
                return
            }

            let stderr = error || PublicOutput.Enabled
            let value = Clean(PublicOutput.Enabled ? PublicOutput.Prose(text): text)
            let width = (stderr ? Console.IsErrorRedirected: Console.IsOutputRedirected) ? int32.MaxValue: Width(stderr)

            for source in value.Split('\n') {
                let indent = source.Length - source.TrimStart().Length
                let prefix = source.Substring(0, indent)
                var remaining = source.Substring(indent)

                while width > indent && remaining.Length + indent > width && !source.Contains(" Run: ") &&
                    !source.StartsWith("Next: ") && !remaining.StartsWith("tokate ") && !remaining.StartsWith("gh ") {
                    var split = remaining.LastIndexOf(' ', Math.Min(remaining.Length - 1, width - indent))
                    if split <= 0 {
                        split = remaining.IndexOf(' ', Math.Min(remaining.Length - 1, width - indent))
                    }
                    if split <= 0 {
                        break
                    }
                    Line(prefix + remaining.Substring(0, split), color, stderr)
                    remaining = remaining.Substring(split + 1)
                }

                Line(prefix + remaining, color, stderr)
            }
        }

        internal func Foreground() bool -> Array.IndexOf(
            []string{"work", "external", "amend", "submit"},
            PublicOutput.Command
        ) >= 0

        internal func Step(text string) -> Message(text, "cyan", Foreground())

        internal func Runs(rows List[SavedRun], saved SavedRuns) {
            let table = List[[]string]{[]string{"WORK", "STATE", "AGE", "NEXT"}}

            for row in rows {
                let name = RunReference.Label(row, saved)
                let next = row.Next
                let target = next == "checks" ? RunReference.Label(row, saved, true): name
                table.Add([]string{name, row.State, row.Age(), next == "" ? "-": "tokate " + next + " " + target})
            }

            Table(table)
        }

        internal func Table(rows List[[]string], error bool = false, fit int32 = -1) {
            let widths = List[int32]()

            for row in rows.Where(row -> row.Length > 1) {
                for i in 0 ... row.Length {
                    row[i] = Clean(row[i]).Replace('\n', ' ').Trim()

                    if widths.Count == i {
                        widths.Add(0)
                    }

                    widths[i] = Math.Max(widths[i], row[i].GetCellWidth())
                }
            }

            if fit >= 0 && !(error ? Console.IsErrorRedirected: Console.IsOutputRedirected) {
                let room = Width(error) - widths.Sum() + widths[fit] - 2 * widths.Count + 2
                widths[fit] = Math.Min(widths[fit], Math.Max(8, room))
            }

            for row in rows {
                if row.Length == 1 {
                    Line(String(' ', widths[0] + 2) + Clean(row[0]).Replace('\n', ' ').Trim(), "default", error)
                    continue
                }

                if fit >= 0 && row[fit].GetCellWidth() > widths[fit] {
                    var text = row[fit]

                    while text.Length > 0 &&
                        (text.GetCellWidth() > widths[fit] - 3 || Char.IsHighSurrogate(text[text.Length - 1])) {
                        text = text.Substring(0, text.Length - 1)
                    }

                    row[fit] = text + "..."
                }

                for i in 0 ... row.Length - 1 {
                    row[i] += String(' ', widths[i] - row[i].GetCellWidth())
                }

                Line(String.Join("  ", row), "default", error)
            }
        }

        internal func Hint(action[]string) string -> Command(Array.FindAll(action, word -> word != "--json"))

        internal func Command(command JsonElement, flatten bool = true) string {
            let words = List[string]()

            if command.ValueKind == JsonValueKind.Array {
                for item in command.EnumerateArray() {
                    words.Add(item.ToString())
                }
            }

            return Command(words.ToArray(), flatten)
        }

        internal func Command(command[]string, flatten bool = true) string {
            let words = StringBuilder()

            for word in RunReference.Short(List[[]string]{command}, false)[0] {
                AppendWord(words, word)
            }

            return CommandText(words, flatten)
        }

        private func AppendWord(words StringBuilder, word string) {
            if words.Length > 0 {
                words.Append(' ')
            }

            words.Append(
                Regex.IsMatch(word, "^[A-Za-z0-9_./:-][A-Za-z0-9_./:#-]*$") ? word:
                "'" + word.Replace("'", "'\"'\"'") + "'"
            )
        }

        private func CommandText(words StringBuilder, flatten bool) string {
            let text = Clean(words.ToString())
            return flatten ? text.Replace('\n', ' '): text
        }

        internal func Verify(
            storage string,
            results List[Object],
            command JsonElement,
            directory string,
            seconds int32,
            budget RuntimeBudget? = nil,
            progressBudget RuntimeBudget? = nil,
            workspace VerificationWorkspace? = nil
        ) CommandResult {
            let name = "Verification " + (results.Count + 1).ToString() + ": " + PublicOutput.Prose(Command(command))
            let timing = progressBudget ?? budget ?? RuntimeBudget(Stopwatch.StartNew(), seconds)

            try {
                workspace?.CheckCancellation()

                var result CommandResult

                Message(name, "cyan", true)
                {
                    using let progress = TerminalProgress(
                        "Owner verification " + (results.Count + 1).ToString(),
                        timing
                    )
                    result = Verification.Check(
                        storage,
                        results,
                        command,
                        workspace?.Checkout ?? directory,
                        seconds,
                        budget
                    )
                }

                Message(
                    name + " - " + (result.Code == 0 ? "passed": "failed") + " (exit " + result.Code.ToString() +
                        "); " +
                        timing.Status(),
                    result.Code == 0 ? "green": "red",
                    true
                )

                return result
            } catch (error Exception) {
                Message(
                    name + " - interrupted or failed; verification_failed. Details: " + Path.Combine(
                        storage,
                        "verification.json"
                    ),
                    "red",
                    true
                )

                throw error
            }
        }

        internal func RunOutcome(exitCode int32, code string) {
            if PublicOutput.RunDirectory == "" || !Foreground() {
                return
            }

            RunReference.Locate()

            try {
                let run = Data.Load(PublicOutput.RunDirectory)
                var stage = "Run"
                if code == "inference_failed" {
                    stage = "Inference"
                } else if code == "verification_failed" {
                    stage = "Verification"
                } else if run.Text("state") == "generated" && exitCode != 0 {
                    stage = "Publication"
                }

                var outcome = " failed (" + code + ")"
                var color = "red"
                if exitCode == 0 {
                    outcome = " completed"
                    color = "green"
                } else if exitCode == 8 {
                    outcome = " pending"
                    color = "yellow"
                }

                Message(stage + outcome + ". Run: " + PublicOutput.RunDirectory, color, true)

                let summary = RunSummaryArtifacts(PublicOutput.RunDirectory)

                Message("Saved artifacts: " + summary, "default", true)

                for action in RunReference.Short(PublicOutput.Actions, false) {
                    Message("Next: " + Hint(action), "default", true)
                }
            } catch (error Exception) { }
        }

        private func RunSummaryArtifacts(directory string) string -> String.Join(
            ", ",
            PublicOutput.Artifacts(directory).Keys
        )

        internal func Heading(title string, error bool = false) {
            if Rich(error) {
                let console = Output(error)
                let ascii = Ascii || !console.Profile.Capabilities.Unicode

                console.Write(ascii ? "* ": "☼ ", Style.Parse(Accent("yellow")))
                console.WriteLine("Tokate", Style.Parse("bold " + Parchment + " on " + Blue))
                console.WriteLine(String(ascii ? '-': '─', Math.Min(Width(error), 32)), Style.Parse(Accent("yellow")))
            }

            if Rich(error) {
                Output(error).WriteLine(Clean(title), Style.Parse("bold"))
            } else {
                Message(title, "default", error)
            }
        }

        internal func Help(command string = "") {
            Heading(command == "" ? "Commands": "Command: " + command)
            Message(Cli.Help(command, Width()), "default")
        }

        internal func Row(label string, value string, color string = "default", error bool = false) {
            let name = Clean(label)
            let text = Clean(value)
            let redirected = error ? Console.IsErrorRedirected: Console.IsOutputRedirected

            if redirected || (name.Length + text.Length + 2 <= Width(error) && !text.Contains('\n')) {
                Message(name + ": " + text, color, error)
            } else {
                Message(name + ":", color, error)

                for line in text.Split('\n') {
                    Line(line, "default", error)
                }
            }
        }

        private func Label(name string) string {
            let text = name.Replace('_', ' ')
            return text.Length == 0 ? text: Char.ToUpperInvariant(text[0]).ToString() + text.Substring(1)
        }

        internal func Fields(value JsonElement, prefix string = "", names bool = false) {
            for field in value.EnumerateObject() {
                let label = prefix + (names ? field.Name: Label(field.Name))

                if field.Value.ValueKind == JsonValueKind.Object {
                    Message(label + ":", "default")
                    Fields(field.Value, prefix + "  ", prefix == "" && field.Name == "profiles")
                } else if field.Value.ValueKind == JsonValueKind.Array {
                    let items = J.Items(field.Value)

                    if field.Name == "command" {
                        Message(label + ":", "default")
                        Line(Command(field.Value, false), "default", false)
                        continue
                    }

                    Message(label + ":" + (items.Count == 0 ? " none": ""), "default")

                    for i in 0 ... items.Count {
                        if field.Name == "allowed_tools" {
                            Line(
                                Clean("  " + J.Text(items[i], "harness") + " / " + J.Text(items[i], "provider")),
                                "default",
                                false
                            )
                        } else if field.Name == "verification" && items[i].ValueKind == JsonValueKind.Array {
                            let command = J.Items(items[i])
                            let text = command.Count == 3 && command[0].ToString() == "/bin/sh" &&
                                command[1].ToString() == "-c" ?
                            command[2].ToString(): Command(items[i], false)
                            Line(Clean("  " + text), "default", false)
                        } else if items[i].ValueKind == JsonValueKind.Object {
                            Message("  " + (i + 1).ToString() + ".", "default")
                            Fields(items[i], "    ")
                        } else {
                            Message("  " + items[i].ToString(), "default")
                        }
                    }
                } else {
                    var text = field.Value.ValueKind == JsonValueKind.String ? field.Value.GetString() ?? "":
                    field.Value.GetRawText()

                    if field.Name == "default" && field.Value.ValueKind == JsonValueKind.Null {
                        text = "none. Choose one with tokate defaults use NAME."
                    }

                    let color = field.Name == "state" || field.Name == "status" || field.Name.EndsWith(
                        "_status",
                        StringComparison.Ordinal
                    ) ? (
                        text == "failed" || text == "ci_failed" ? "red":
                        (
                            text == "passed" ||
                                text == "pass" ||
                                text == "current" ||
                                text == "eligible" ? "green": "yellow"
                        )
                    ): "default"
                    Row(label, text, color)
                }
            }
        }

        internal func Json(value JsonElement, title string) {
            if PublicOutput.Enabled {
                PublicOutput.ResultData = J.Select(
                    value,
                    "reservation,lease,donor,actor,expires,status,attempt,pr,url,head"
                )

                return
            }

            if Console.IsOutputRedirected && !Plain && !Ascii {
                Console.WriteLine(J.Write(value))

                return
            }

            Heading(title)
            Fields(value)
        }

        internal func Checks(rows JsonElement) {
            for check in J.Items(rows) {
                var state = J.Text(check, "bucket")

                if state == "" {
                    state = J.Text(check, "state")
                }

                if state == "" {
                    state = "unknown"
                }

                Row(J.Text(check, "name"), state, state == "pass" ? "green": (state == "fail" ? "red": "yellow"))

                let link = J.Text(check, "link")

                if link != "" {
                    Message(link, "default")
                }
            }
        }
    }
}
