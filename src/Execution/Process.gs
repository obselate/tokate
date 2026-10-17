package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.ComponentModel
import System.Diagnostics
import System.IO
import System.Runtime.InteropServices
import System.Text
import System.Text.Json

internal class CommandResult {
    internal var Code int32?
    internal var Output string = ""
    internal var Error string = ""
    internal var Truncated bool
    internal var ReadFailed bool
    internal var OutputTruncated bool
    internal var ErrorTruncated bool
}

internal class CommandOutput {
    internal var Text string = ""
    internal var Truncated bool
    internal var Failure Exception?
}

internal class CommandLines {
    private let Line StringBuilder = StringBuilder()
    private let Observe Action[string]
    private var Oversize bool

    shared {
        private const LineCharacterLimit int32 = 65536
    }

    internal init(observe Action[string]) {
        Observe = observe
    }

    internal func Flush() {
        if !Oversize && Line.Length > 0 {
            try {
                Observe.Invoke(Line.ToString())
            } catch (error JsonException) { }
        }

        Line.Clear()
        Oversize = false
    }

    internal func Add(buffer[]char, count int32) {
        for i in 0 ... count {
            if buffer[i] == '\n' {
                Flush()
            } else if Line.Length < LineCharacterLimit {
                Line.Append(buffer[i])
            } else {
                Oversize = true
            }
        }
    }
}

internal class CommandInterrupted : Exception {
    internal let Result CommandResult

    internal init(error Exception, result CommandResult) : base(error.Message, error) {
        Result = result
    }
}

internal class CommandInputInterrupted : IOException {
    internal let Result CommandResult

    internal init(error IOException, result CommandResult) : base(error.Message, error) {
        Result = result
    }
}

@DllImport("libc", EntryPoint: "kill")
func KillGroup(pid int32, signal int32) int32;

internal class CommandExecution {
    internal var Exe string
    internal var Process Process
    internal var Limit int32
    internal var Allowance TimeSpan
    internal var Budget RuntimeBudget?
    internal var Clock Stopwatch
    internal var Exited Chan[Exception?]
    internal var Stdin Chan[Exception?]
    internal var Stdout Chan[CommandOutput]
    internal var Stderr Chan[CommandOutput]
    internal var Cancelled Chan[bool]
    internal var Failed Chan[Exception]
    internal var Deadline AfterTimer
    internal var OutputReader StreamReader?
    internal var Callback CommandCancellation?
    internal var OnCancel ConsoleCancelEventHandler?
    internal var InputStarted bool
    internal var OutputStarted bool
    internal var ErrorStarted bool
    internal var Ready bool
    internal var InputDone bool
    internal var OutputDone bool
    internal var ErrorDone bool
    internal var ExitDone bool
    internal var InputFailed bool
    internal var Output CommandOutput
    internal var ErrorOutput CommandOutput
    internal var Terminal Exception?
}

internal class CommandCancellation {
    private let Process Process
    private let Signal Chan[bool]?
    private let Lifetime Chan[bool] = Chan[bool](1)

    internal init(process Process, signal Chan[bool]?) {
        Process = process
        Signal = signal
        Lifetime <- true
    }

    internal func Cancel() {
        let active = <-Lifetime

        try {
            if !active {
                return
            }

            if let signal = Signal {
                select {
                    case signal <- true { }
                    default { }
                }
            }

            KillGroup(-Process.Id, Commands.KillSignal)
        } finally {
            Lifetime <- active
        }
    }

    internal func OnCancel(sender Object?, event ConsoleCancelEventArgs) {
        if Signal != nil {
            event.Cancel = true
        }

        Cancel()
    }

    internal func Stop() {
        <-Lifetime
        Lifetime <- false
    }
}

internal class RuntimeBudget {
    private let Timer Stopwatch
    private let Seconds int32

    internal init(timer Stopwatch, seconds int32) {
        Timer = timer
        Seconds = seconds
    }

    internal func Expired() bool -> Seconds > 0 && Timer.Elapsed.TotalSeconds >= Seconds

    internal func Left() string -> Seconds == 0 ? "unlimited": Math.Max(
        0,
        Math.Ceiling(Seconds - Timer.Elapsed.TotalSeconds)
    )
        .ToString() + "s"

    internal func Status() string -> Math.Floor(Timer.Elapsed.TotalSeconds).ToString() +
        "s elapsed, " +
        (Seconds == 0 ? "no time limit": Left() + " remaining")

    internal func Remaining() int32 {
        if Seconds == 0 {
            return -1
        }

        let remaining = Math.Floor(Seconds * 1000.0 - Timer.Elapsed.TotalMilliseconds)
        if remaining < 1 {
            throw ExecutionFailure.Create("command_failed", "Runtime allowance exhausted")
        }

        return Convert.ToInt32(remaining)
    }

    internal func Git(checkout string, args ...string) string ->
    Commands.GitOutput(Commands.GitResult(checkout, args, budget: this))

    shared {
        internal const MaxBudgetSeconds int32 = 86400

        internal const SecondsPerDay int32 = 86400

        internal const SecondsPerHour int32 = 3600

        internal const SecondsPerMinute int32 = 60

        internal const MinutesPerHour int32 = 60

        internal func ReadSeconds(args Args) int32 -> args.Get("unlimited") == "true" ?
        args.Number("verification-reserve"): args.Number("seconds")

        internal func Reserve(args Args, seconds int32) int32 {
            let reserve = args.Get("verification-reserve") == "" ? 0: args.Number("verification-reserve")

            if args.Get("unlimited") == "true" {
                if reserve < 1 || reserve != seconds {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Unlimited coding requires a separate positive verification budget"
                    )
                }
            } else if reserve >= seconds {
                throw ExecutionFailure.Create("invalid_state", "--verify-time must be shorter than --time")
            }

            return reserve
        }

        internal func Validate(run Data) {
            if !run.UnlimitedIsValid {
                throw ExecutionFailure.Create("invalid_state", "Invalid saved unlimited coding choice")
            }

            if run.Unlimited &&
                (
                run.Version != 2 ||
                    run.Source != "tokate" ||
                    run.VerificationReserve < 1 ||
                    run.VerificationReserve != run.Seconds
            ) {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Unlimited coding requires managed v2 work and a separate positive verification budget"
                )
            }

            let reserve = run.VerificationReserve
            if run.HasVerificationReserve &&
                (reserve < 1 || (run.Unlimited ? reserve != run.Seconds: reserve >= run.Seconds)) {
                throw ExecutionFailure.Create("invalid_state", "Invalid saved verification reserve")
            }
        }

        internal func Description(run Data) string {
            let total = run.Seconds
            let reserve = run.VerificationReserve
            if run.Unlimited {
                return "unlimited coding time, independent verification budget " + reserve.ToString() + "s"
            }

            if reserve == 0 {
                return "total allowance " + total.ToString() +
                    "s, no verification reserve, verification gets only the time coding leaves"
            }

            return "total allowance " + total.ToString() + "s, coding allowance " + (total - reserve).ToString() +
                "s, verification reserve " +
                reserve.ToString() + "s"
        }
    }
}

internal class Commands {
    shared {
        internal const VersionTimeoutSeconds int32 = 30

        private const StreamBufferSize int32 = 8192

        private const OutputCharacterLimit int32 = 32 * 1024 * 1024

        private const GitPathByteLimit int32 = 32 * 1024 * 1024

        internal const KillSignal int32 = 9

        private const FailureChannelCapacity int32 = 4

        internal func InterruptedResult(error Exception) CommandResult? -> switch error {
            case interrupted is CommandInterrupted: interrupted.Result
            case interrupted is CommandInputInterrupted: interrupted.Result
            case failure is CliFailure: failure.Data["command_result"] as CommandResult
            default: nil
        }

        internal func Capture(path string) FileStream? {
            if path == "" {
                return nil
            }

            LocalPaths.DirectoryPath(Path.GetDirectoryName(Path.GetFullPath(path)) ?? "/")

            return FileStream(
                path,
                FileStreamOptions{
                    Mode: FileMode.CreateNew,
                    Access: FileAccess.Write,
                    Share: FileShare.Read,
                    BufferSize: 1,
                    UnixCreateMode: UnixFileMode.UserRead | UnixFileMode.UserWrite
                }
            )
        }

        internal func Read(
            reader StreamReader,
            output Chan[CommandOutput],
            failed Chan[Exception],
            capture FileStream? = nil,
            observe Action[string]? = nil
        ) {
            let result = CommandOutput()
            let text = StringBuilder()
            let lines CommandLines? = if observe == nil {
                nil
            } else {
                CommandLines(observe)
            }

            try {
                using let writer StreamWriter? = capture == nil ? nil: StreamWriter(
                    capture,
                    UTF8Encoding(false),
                    StreamBufferSize,
                    true
                )

                if let activeWriter = writer {
                    activeWriter.AutoFlush = true
                }

                let buffer = [StreamBufferSize]char
                var count int32

                while (count = reader.Read(buffer, 0, buffer.Length)) > 0 {
                    var retained = result.Truncated ? 0: Math.Min(count, OutputCharacterLimit - text.Length)

                    if retained > 0 && text.Length + retained == OutputCharacterLimit && Char.IsHighSurrogate(
                        buffer[retained - 1]
                    ) {
                        retained -= 1
                    }

                    result.Truncated = result.Truncated || retained < count

                    if retained > 0 {
                        text.Append(buffer, 0, retained)
                        lines?.Add(buffer, retained)
                        if writer != nil && result.Failure == nil {
                            try {
                                writer.Write(buffer, 0, retained)
                            } catch (error Exception) when error is IOException ||
                                error is UnauthorizedAccessException ||
                                error is EncoderFallbackException ||
                                error is ArgumentOutOfRangeException limitError &&
                                limitError.ParamName == "value" {
                                result.Failure = error
                                failed <- error
                            }
                        }
                    }
                }
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is DecoderFallbackException ||
                error is EncoderFallbackException ||
                error is ArgumentOutOfRangeException limitError &&
                limitError.ParamName == "value" {
                result.Failure = error
                failed <- error
            }

            lines?.Flush()
            result.Text = text.ToString()

            output <- result
        }

        private func Collect(result CommandResult, output CommandOutput, error CommandOutput) {
            result.Output = output.Text
            result.Error = error.Text
            result.OutputTruncated = output.Truncated
            result.ErrorTruncated = error.Truncated
            result.Truncated = output.Truncated || error.Truncated
            result.ReadFailed = output.Failure != nil || error.Failure != nil
        }

        private func Write(writer StreamWriter, input string?, completed Chan[Exception?]) {
            var failure Exception? = nil

            try {
                if let text = input {
                    writer.Write(text)
                }
            } catch (error IOException) {
                failure = error
            } finally {
                try {
                    writer.Close()
                } catch (error IOException) {
                    failure ??= error
                }
            }

            completed <- failure
        }

        internal func Wait(info ProcessStartInfo, started Chan[Process?], completed Chan[Exception?]) {
            var process Process? = nil
            var failure Exception? = nil

            try {
                process = Process.Start(info) ?? throw Exception("Cannot start " + info.ArgumentList[0])
            } catch (error Exception) when error is Win32Exception ||
                error is InvalidOperationException ||
                error.GetType() == typeof(Exception) {
                failure = error
            }

            started <- process

            if let child = process {
                try {
                    child.WaitForExit()
                } catch (error Exception) when error is Win32Exception || error is InvalidOperationException {
                    failure = error
                }
            }

            completed <- failure
        }

        private func StartInfo(
            exe string,
            args[]string,
            cwd string,
            harness bool,
            github bool,
            isolated bool
        ) ProcessStartInfo {
            let info = ProcessStartInfo(isolated ? LocalPaths.NeedSystemTool("setsid", cwd): "setsid")
            info.ArgumentList.Add("--wait")

            let setpriv = LocalPaths.SystemTool("setpriv", cwd)
            let unshare = LocalPaths.SystemTool("unshare", cwd)
            let environment = LocalPaths.SystemTool("env", cwd)

            if !OperatingSystem.IsLinux() || !LocalPaths.Executable(setpriv) || !LocalPaths.Executable(unshare) ||
                !LocalPaths
                .Executable(environment) {
                throw CliFailure(
                    "missing_tools",
                    "Command cleanup requires Linux, setpriv, unshare, and env",
                    summary: "PID namespace prerequisite is unavailable"
                )
            }

            info.ArgumentList.Add(setpriv)
            info.ArgumentList.Add("--pdeathsig")
            info.ArgumentList.Add("KILL")
            info.ArgumentList.Add(unshare)
            info.ArgumentList.Add("--map-current-user")
            info.ArgumentList.Add("--pid")
            info.ArgumentList.Add("--fork")
            info.ArgumentList.Add("--kill-child")
            info.ArgumentList.Add("--mount-proc")
            info.ArgumentList.Add("--")
            info.ArgumentList.Add(environment)
            info.ArgumentList.Add("-u")
            info.ArgumentList.Add("LC_ALL")
            info.ArgumentList.Add("--")
            info.ArgumentList.Add(exe)

            info.UseShellExecute = false
            info.RedirectStandardOutput = true
            info.RedirectStandardError = true
            info.RedirectStandardInput = true

            if cwd != "" {
                info.WorkingDirectory = cwd
            }

            for arg in args {
                info.ArgumentList.Add(arg)
            }

            info.Environment.Clear()
            let requirements = List[string]{"PATH", "HOME", "LANG"}

            if harness {
                requirements.Add("CODEX_HOME")
            }

            if github {
                requirements.AddRange(
                    []string{
                        "GH_TOKEN",
                        "GITHUB_TOKEN",
                        "GH_CONFIG_DIR",
                        "XDG_CONFIG_HOME",
                        "DBUS_SESSION_BUS_ADDRESS",
                        "XDG_RUNTIME_DIR"
                    }
                )
            }

            for key in requirements {
                if isolated {
                    continue
                }

                if let value = Environment.GetEnvironmentVariable(key) {
                    info.Environment[key] = value
                }
            }

            if isolated {
                info.Environment["PATH"] = "/usr/local/bin:/usr/bin:/bin"
            }

            let certificates = LocalPaths.Certificates()
            if certificates != "" {
                info.Environment["SSL_CERT_FILE"] = certificates
                info.Environment["GIT_SSL_CAINFO"] = certificates
                info.Environment["CURL_CA_BUNDLE"] = certificates
            }

            info.Environment["GH_HOST"] = "github.com"
            info.Environment["GH_PROMPT_DISABLED"] = "1"
            info.Environment["GIT_TERMINAL_PROMPT"] = "0"
            info.Environment["GIT_CONFIG_NOSYSTEM"] = "1"
            info.Environment["GIT_CONFIG_GLOBAL"] = "/dev/null"
            info.Environment["GIT_NO_REPLACE_OBJECTS"] = "1"
            info.Environment["GIT_GRAFT_FILE"] = "/dev/null"
            info.Environment["LC_ALL"] = "C"

            return info
        }

        private func CheckNamespaceResult(result CommandResult) {
            if result.Code != 0 {
                for prefix in[]string{
                    "setsid: failed to execute ",
                    "setpriv: failed to execute ",
                    "unshare: failed to execute "
                } {
                    if result.Error.StartsWith(prefix, StringComparison.Ordinal) {
                        throw CliFailure(
                            "missing_tools",
                            "A PID namespace command helper could not execute. Repair the helper, then run tokate doctor."
                        )
                    }
                }

                for prefix in[]string{
                    "unshare: unshare failed:",
                    "unshare: mount /proc failed:",
                    "unshare: mount proc on /proc failed:",
                    "unshare: write failed /proc/self/",
                    "unshare: failed to write /proc/self/",
                    "unshare: failed to open /proc/self/",
                    "unshare: setgroups failed:"
                } {
                    if result.Error.StartsWith(prefix, StringComparison.Ordinal) {
                        throw LinuxSandbox.NamespaceFailure(result.Error)
                    }
                }
            }
        }

        private func ExecuteProcess(
            execution CommandExecution,
            result CommandResult,
            input string?,
            cancellation Chan[bool]?,
            strictOutput bool,
            outputCapture FileStream?,
            errorCapture FileStream?,
            outputLine Action[string]?,
            errorLine Action[string]?
        ) {
            let process = execution.Process

            try {
                let reader = strictOutput ? StreamReader(
                    process.StandardOutput.BaseStream,
                    UTF8Encoding(false, true),
                    false
                ): process.StandardOutput
                execution.OutputReader = reader
                let active = CommandCancellation(process, cancellation)
                execution.Callback = active
                let handler = ConsoleCancelEventHandler(active.OnCancel)
                Console.CancelKeyPress += handler
                execution.OnCancel = handler

                go Commands.Write(process.StandardInput, input, execution.Stdin)
                execution.InputStarted = true
                go Commands.Read(reader, execution.Stdout, execution.Failed, outputCapture, outputLine)
                execution.OutputStarted = true
                go Commands.Read(process.StandardError, execution.Stderr, execution.Failed, errorCapture, errorLine)
                execution.ErrorStarted = true
                execution.Ready = true

                WaitForStreams(execution)
                result.Code = process.ExitCode
            } catch (error Exception) when error is CliFailure || error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is DecoderFallbackException ||
                error is InvalidOperationException ||
                error is ArgumentOutOfRangeException limitError &&
                limitError.ParamName == "value" {
                execution.Terminal = error
            } finally {
                CleanupProcess(execution)
            }
        }

        private func WaitForStreams(execution CommandExecution) {
            while !execution.InputDone || !execution.OutputDone || !execution.ErrorDone || !execution.ExitDone {
                if (execution.Limit > 0 && execution.Clock.Elapsed >= execution.Allowance) ||
                    (execution.Budget?.Expired() ?? false) {
                    throw Exception("Runtime limit reached for " + execution.Exe)
                }

                var failure Exception? = nil

                select {
                    case let error = <- execution.Stdin {
                        execution.InputDone = true
                        failure = error
                        execution.InputFailed = error != nil
                    }
                    case let captured = <- execution.Stdout {
                        execution.OutputDone = true
                        execution.Output = captured
                        failure = captured.Failure
                    }
                    case let captured = <- execution.Stderr {
                        execution.ErrorDone = true
                        execution.ErrorOutput = captured
                        failure = captured.Failure
                    }
                    case let error = <- execution.Exited {
                        execution.ExitDone = true
                        KillGroup(-execution.Process.Id, KillSignal)
                        failure = error
                    }
                    case let error = <- execution.Failed {
                        throw error
                    }
                    case <- execution.Cancelled {
                        throw Exception("Command cancelled: " + execution.Exe)
                    }
                    case <- execution.Deadline {
                        throw Exception("Runtime limit reached for " + execution.Exe)
                    }
                }

                select {
                    case <- execution.Cancelled {
                        throw Exception("Command cancelled: " + execution.Exe)
                    }
                    default { }
                }

                if (execution.Limit > 0 && execution.Clock.Elapsed >= execution.Allowance) ||
                    (execution.Budget?.Expired() ?? false) {
                    throw Exception("Runtime limit reached for " + execution.Exe)
                }

                if let error = failure {
                    throw error
                }
            }
        }

        private func CleanupProcess(execution CommandExecution) {
            if let handler = execution.OnCancel {
                Console.CancelKeyPress -= handler
            }

            if let active = execution.Callback {
                active.Stop()
            }

            let process = execution.Process
            KillGroup(-process.Id, KillSignal)

            if !process.HasExited {
                try {
                    process.Kill(true)
                } catch (error InvalidOperationException) { }
            }

            process.WaitForExit()

            if !execution.ExitDone {
                <-execution.Exited
            }

            if execution.InputStarted && !execution.InputDone {
                <-execution.Stdin
            }

            if execution.OutputStarted && !execution.OutputDone {
                execution.Output = <-execution.Stdout
            }

            if execution.ErrorStarted && !execution.ErrorDone {
                execution.ErrorOutput = <-execution.Stderr
            }

            execution.OutputReader?.Dispose()
        }

        private func CompleteProcess(execution CommandExecution, result CommandResult) {
            Collect(result, execution.Output, execution.ErrorOutput)

            if execution.Terminal == nil {
                select {
                    case <- execution.Cancelled {
                        execution.Terminal = Exception("Command cancelled: " + execution.Exe)
                    }
                    default { }
                }

                if (execution.Limit > 0 && execution.Clock.Elapsed >= execution.Allowance) ||
                    (execution.Budget?.Expired() ?? false) {
                    execution.Terminal = Exception("Runtime limit reached for " + execution.Exe)
                }
            }

            execution.Terminal = execution.Terminal ?? execution.Output.Failure ?? execution.ErrorOutput.Failure

            if let error = execution.Terminal {
                result.Code = nil

                if !execution.Ready {
                    throw error
                }

                if error is IOException io && execution.InputFailed {
                    throw CommandInputInterrupted(io, result)
                }

                throw CommandInterrupted(error, result)
            }

            CheckNamespaceResult(result)
        }

        internal func Run(
            exe string,
            args[]string,
            cwd string = "",
            input string? = nil,
            seconds int32 = 60,
            harness bool = false,
            github bool = false,
            isolated bool = false,
            milliseconds int32 = 0,
            cancellation Chan[bool]? = nil,
            strictOutput bool = false,
            outputPath string = "",
            errorPath string = "",
            budget RuntimeBudget? = nil,
            outputLine Action[string]? = nil,
            errorLine Action[string]? = nil
        ) CommandResult {
            let info = StartInfo(exe, args, cwd, harness, github, isolated)

            if let signal = cancellation {
                select {
                    case <- signal {
                        throw Exception("Command cancelled: " + exe)
                    }
                    default { }
                }
            }

            using let outputCapture = Capture(outputPath)
            using let errorCapture = Capture(errorPath)
            let requested = milliseconds > 0 ? milliseconds: seconds * 1000
            let remaining = budget?.Remaining() ?? -1
            let limit = requested > 0 && remaining > 0 ? Math.Min(requested, remaining): Math.Max(requested, remaining)
            let allowance = TimeSpan.FromMilliseconds(limit > 0 ? limit: -1)
            let started = Chan[Process?](1)
            let exited = Chan[Exception?](1)
            let stdin = Chan[Exception?](1)
            let stdout = Chan[CommandOutput](1)
            let stderr = Chan[CommandOutput](1)
            let cancelled = cancellation ?? Chan[bool](1)
            let result = CommandResult()
            let failed = Chan[Exception](FailureChannelCapacity)
            let clock = Stopwatch.StartNew()
            using let deadline = after(allowance)

            go Commands.Wait(info, started, exited)
            let launched = <-started
            if launched == nil {
                let failure = <-exited
                throw failure ?? Exception("Cannot start " + exe)
            }

            using let process = launched
            let execution = CommandExecution{
                Exe: exe,
                Process: process,
                Limit: limit,
                Allowance: allowance,
                Budget: budget,
                Clock: clock,
                Exited: exited,
                Stdin: stdin,
                Stdout: stdout,
                Stderr: stderr,
                Cancelled: cancelled,
                Failed: failed,
                Deadline: deadline,
                Output: CommandOutput(),
                ErrorOutput: CommandOutput()
            }

            ExecuteProcess(
                execution,
                result,
                input,
                cancellation,
                strictOutput,
                outputCapture,
                errorCapture,
                outputLine,
                errorLine
            )
            CompleteProcess(execution, result)

            return result
        }

        internal func Checked(
            exe string,
            args[]string,
            cwd string = "",
            input string? = nil,
            seconds int32 = 60,
            harness bool = false,
            github bool = false
        ) string {
            let result = Run(exe, args, cwd, input, seconds, harness, github)
            if result.Code != 0 {
                throw CliFailure(
                    "command_failed",
                    exe + " failed: " + result.Error + result.Output,
                    summary: exe + " failed. Inspect private artifacts when available."
                )
            }

            return result.Output.Trim()
        }

        internal func GitResult(cwd string, args[]string, raw bool = false, budget RuntimeBudget? = nil) CommandResult {
            let all = List[string]{
                "--no-replace-objects",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "protocol.file.allow=never",
                "-c",
                "protocol.ext.allow=never"
            }

            all.AddRange(args)

            return Run(
                "git",
                all.ToArray(),
                cwd,
                github: Array.IndexOf(args, "credential.helper=!gh auth git-credential") >= 0,
                strictOutput: raw,
                budget: budget
            )
        }

        internal func Git(cwd string, args ...string) string -> GitOutput(GitResult(cwd, args))

        internal func GitOutput(result CommandResult) string {
            if result.Code != 0 {
                throw Exception("git failed: " + result.Error + result.Output)
            }

            return result.Output.Trim()
        }

        internal func GitRaw(cwd string, args[]string, budget RuntimeBudget? = nil) string {
            try {
                let result = GitResult(cwd, args, true, budget)
                if result.Code != 0 || result.Truncated || result.ReadFailed || Encoding.UTF8.GetByteCount(
                    result.Output
                ) > GitPathByteLimit {
                    throw Exception("Cannot read complete Git path evidence: " + result.Error)
                }

                return result.Output
            } catch (error CommandInterrupted) {
                if error.Result.ReadFailed && error.InnerException is DecoderFallbackException {
                    throw Exception("Cannot read complete Git path evidence", error)
                }

                throw error
            }
        }
    }
}
