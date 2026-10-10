package TokateDesktop

import System
import System.Collections.Generic

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

    let Limit int32

    init(limit int32) {
        Limit = limit
    }

    prop Lines IReadOnlyList[OutputLine] -> lines

    prop Revision int64 -> next

    /// Adds each nonblank line of `text`.
    func Append(text string) {
        for part in text.Split('\n') {
            let content = part.TrimEnd('\r')
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
    }
}
