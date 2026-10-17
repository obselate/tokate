package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class CliOutput : OutputSink {
    public override prop Enabled bool -> PublicOutput.Enabled

    public override prop Donating bool -> Donate.Active

    public override prop RunDirectory string {
        get -> PublicOutput.RunDirectory
        set -> PublicOutput.RunDirectory = value
    }

    public override prop FailureCode string {
        get -> PublicOutput.FailureCode
        set -> PublicOutput.FailureCode = value
    }

    public override prop ResultData Object? {
        get -> PublicOutput.ResultData
        set -> PublicOutput.ResultData = value
    }

    public override prop Truncated bool {
        get -> PublicOutput.Truncated
        set -> PublicOutput.Truncated = value
    }

    public override prop Actions List[[]string] -> PublicOutput.Actions

    public override func Message(text string, color string = "green", error bool = false) -> Terminal.Message(
        text,
        color,
        error
    )

    public override func Step(text string) -> Terminal.Step(text)

    public override func Command(command JsonElement, flatten bool = true) string -> Terminal.Command(command, flatten)

    public override func Command(command[]string, flatten bool = true) string -> Terminal.Command(command, flatten)

    public override func Hint(action[]string) string -> Terminal.Hint(action)

    public override func Active() bool -> DonationView.Active()

    public override func Append(text string) -> DonationView.Append(text)

    public override func Progress(
        phase string,
        budget RuntimeBudget,
        total RuntimeBudget? = nil
    ) IDisposable -> TerminalProgress(phase, budget, total)

    public override func ConfirmSelection(args Args, selection JsonElement, run Data? = nil) -> DonorSelection.Confirm(
        args,
        selection,
        run
    )

    public override suspend func RunSummary(directory string) Dictionary[string, Object?] -> PublicOutput.RunSummary(
        directory
    )

    public override func Coordination(value CoordinationState, sha string) Object -> PublicOutput.Coordination(
        value,
        sha
    )

    public override func CheckResult(
        run Data,
        rows JsonElement,
        status string,
        facts Dictionary[string, Object?]
    ) -> PublicOutput.Checks(run, rows, status, facts)

    public override func RequestOutcome(value JsonElement) -> Terminal.Json(
        value,
        "Recorded request outcome; no comment posted",
        raw: false
    )

    public override suspend func Next(options Args?, code string) -> PublicOutput.Next(options, code)
}
