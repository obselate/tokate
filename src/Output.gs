package Tokate

import System
import System.Collections.Generic
import System.Globalization
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal interface IOutput {
    prop Enabled bool {
        get
    }

    prop Plain bool {
        get
    }

    prop Donating bool {
        get
    }

    prop RunDirectory string {
        get
        set
    }

    prop FailureCode string {
        get
        set
    }

    prop ResultData Object? {
        get
        set
    }

    prop Truncated bool {
        get
        set
    }

    prop Actions List[[]string] {
        get
    }

    func Message(text string, color string = "green", error bool = false);

    func Step(text string);

    func Line(value string, color string, error bool);

    func Table(rows List[[]string], error bool = false, fit int32 = -1);

    func Heading(title string, error bool = false);

    func Row(label string, value string, color string = "default", error bool = false);

    func Json(value JsonElement, title string, raw bool = true);

    func Checks(rows JsonElement);

    func Command(command JsonElement, flatten bool = true) string;

    func Command(command[]string, flatten bool = true) string;

    func Hint(action[]string) string;

    func Active() bool;

    func Start() bool;

    func Append(text string);

    func Status(text string);

    func Close();

    func Progress(phase string, budget RuntimeBudget, total RuntimeBudget? = nil) IDisposable;

    func Confirm(args Args, question string = "Apply these changes?") bool;

    func ConfirmSelection(args Args, selection JsonElement, run Data? = nil);

    func RunSummary(directory string) Dictionary[string, Object?];

    func Coordination(value JsonElement, sha string) Object;

    func CheckResult(run Data, rows JsonElement, status string, facts Dictionary[string, Object?]);

    func Next(options Args?, code string);
}

internal class Output {
    shared {
        internal var Sink IOutput

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

        internal func Prose(value string) string {
            var truncated bool = false
            let text = Prose(value, ref truncated)

            if truncated {
                Sink.Truncated = true
            }

            return text
        }

        internal func Prose(value string, ref truncated bool) string {
            if value.Length <= 2048 {
                return value
            }

            truncated = true

            return value.Substring(0, Char.IsHighSurrogate(value[2047]) ? 2047: 2048)
        }
    }
}
