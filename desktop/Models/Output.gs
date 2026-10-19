package TokateDesktop

import System
import System.Collections.Generic
import System.Text

/// One line of command output. `Position` counts every line the tail has received, so it never changes
/// and only increases.
data struct OutputLine {
    var Position int64
    var Content string

    prop Key string -> Position.ToString()
}

/// The latest `Limit` lines of a command's output. Appending touches only the new lines, and `Revision`
/// changes whenever the lines do.
class OutputTail {
    private let lines List[OutputLine] = List[OutputLine]()
    private var next int64
    private var first int64

    let Limit int32

    init(limit int32) {
        Limit = limit
    }

    prop Lines IReadOnlyList[OutputLine] -> lines

    prop Revision int64 -> next

    /// Whether lines since the last `Clear` no longer fit and were removed.
    prop Dropped bool -> lines.Count > 0 && lines[0].Position > first

    /// Adds each line of `text` as a terminal shows it, skipping lines that show nothing.
    func Append(text string) {
        for part in text.Split('\n') {
            let content = Displayed(part)
            if !String.IsNullOrWhiteSpace(content) {
                lines.Add(OutputLine{Position: next, Content: content})
                next++
            }
        }
        if lines.Count > Limit {
            lines.RemoveRange(0, lines.Count - Limit)
        }
    }

    func Clear() {
        lines.Clear()
        next++
        first = next
    }

    shared {
        /// The text a terminal shows for one line of output: a carriage return starts the line over, and escape
        /// sequences such as colours and links, along with other control characters except tabs, show nothing.
        func Displayed(line string) string {
            let visible = line.TrimEnd('\r')
            var i = visible.LastIndexOf('\r') + 1
            let result = StringBuilder(visible.Length - i)
            while i < visible.Length {
                let c = visible[i]
                i++
                if c == '\u001b' && i < visible.Length {
                    let kind = visible[i]
                    i++
                    if kind == '[' {
                        while i < visible.Length && (visible[i] < '@' || visible[i] > '~') {
                            i++
                        }
                        i++
                    } else if kind == ']' {
                        while i < visible.Length && visible[i] != '\u0007' && visible[i] != '\u001b' {
                            i++
                        }
                        i += i < visible.Length && visible[i] == '\u001b' ? 2: 1
                    }
                } else if c == '\t' || !Char.IsControl(c) {
                    result.Append(c)
                }
            }
            return result.ToString()
        }
    }
}
