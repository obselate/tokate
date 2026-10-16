package Tokate

import System
import System.Collections.Generic
import System.Globalization
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal open class OutputSink {
    public open prop Enabled bool {
        get
    }

    public open prop Plain bool {
        get
    }

    public open prop Donating bool {
        get
    }

    public open prop RunDirectory string {
        get
        set
    }

    public open prop FailureCode string {
        get
        set
    }

    public open prop ResultData Object? {
        get
        set
    }

    public open prop Truncated bool {
        get
        set
    }

    public open prop Actions List[[]string] {
        get
    }

    public open func Message(text string, color string = "green", error bool = false);

    public open func Step(text string);

    public open func Command(command JsonElement, flatten bool = true) string;

    public open func Command(command[]string, flatten bool = true) string;

    public open func Hint(action[]string) string;

    public open func Active() bool;

    public open func Start() bool;

    public open func Append(text string);

    public open func Status(text string);

    public open suspend func Close();

    public open func Progress(phase string, budget RuntimeBudget, total RuntimeBudget? = nil) IDisposable;

    public open func Confirm(args Args, question string = "Apply these changes?") bool;

    public open func ConfirmSelection(args Args, selection JsonElement, run Data? = nil);

    public open suspend func RunSummary(directory string) Dictionary[string, Object?];

    public open func Coordination(value JsonElement, sha string) Object;

    public open func CheckResult(run Data, rows JsonElement, status string, facts Dictionary[string, Object?]);

    public open func RequestOutcome(value JsonElement);

    public open suspend func Next(options Args?, code string);
}

internal class Output {
    shared {
        internal var Sink OutputSink

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
