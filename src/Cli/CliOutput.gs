package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class CliOutput : IOutput {
    public prop Enabled bool -> PublicOutput.Enabled

    public prop Plain bool -> Terminal.Plain

    public prop Donating bool -> Donate.Active

    public prop RunDirectory string {
        get -> PublicOutput.RunDirectory
        set -> PublicOutput.RunDirectory = value
    }

    public prop FailureCode string {
        get -> PublicOutput.FailureCode
        set -> PublicOutput.FailureCode = value
    }

    public prop ResultData Object? {
        get -> PublicOutput.ResultData
        set -> PublicOutput.ResultData = value
    }

    public prop Truncated bool {
        get -> PublicOutput.Truncated
        set -> PublicOutput.Truncated = value
    }

    public prop Actions List[[]string] -> PublicOutput.Actions

    public func Message(text string, color string = "green", error bool = false) -> Terminal.Message(text, color, error)

    public func Step(text string) -> Terminal.Step(text)

    public func Line(value string, color string, error bool) -> Terminal.Line(value, color, error)

    public func Table(rows List[[]string], error bool = false, fit int32 = -1) -> Terminal.Table(rows, error, fit)

    public func Heading(title string, error bool = false) -> Terminal.Heading(title, error)

    public func Row(label string, value string, color string = "default", error bool = false) -> Terminal.Row(
        label,
        value,
        color,
        error
    )

    public func Json(value JsonElement, title string, raw bool = true) -> Terminal.Json(value, title, raw)

    public func Checks(rows JsonElement) -> Terminal.Checks(rows)

    public func Command(command JsonElement, flatten bool = true) string -> Terminal.Command(command, flatten)

    public func Command(command[]string, flatten bool = true) string -> Terminal.Command(command, flatten)

    public func Hint(action[]string) string -> Terminal.Hint(action)

    public func Active() bool -> DonationView.Active()

    public func Start() bool -> DonationView.Start()

    public func Append(text string) -> DonationView.Append(text)

    public func Status(text string) -> DonationView.Status(text)

    public suspend func Close() -> DonationView.Close()

    public func Progress(
        phase string,
        budget RuntimeBudget,
        total RuntimeBudget? = nil
    ) IDisposable -> TerminalProgress(phase, budget, total)

    public func Confirm(args Args, question string = "Apply these changes?") bool -> OwnerSetup.Confirm(args, question)

    public func ConfirmSelection(args Args, selection JsonElement, run Data? = nil) -> DonorSelection.Confirm(
        args,
        selection,
        run
    )

    public suspend func RunSummary(directory string) Dictionary[string, Object?] -> PublicOutput.RunSummary(directory)

    public func Coordination(value JsonElement, sha string) Object -> PublicOutput.Coordination(value, sha)

    public func CheckResult(
        run Data,
        rows JsonElement,
        status string,
        facts Dictionary[string, Object?]
    ) -> PublicOutput.Checks(run, rows, status, facts)

    public suspend func Next(options Args?, code string) -> PublicOutput.Next(options, code)
}
