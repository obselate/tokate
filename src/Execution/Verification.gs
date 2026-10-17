package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Verification {
    internal class Result(command JsonElement) {
        internal let Command JsonElement = command
        internal var State string? = nil
        internal var OutputFile string? = nil
        internal var ErrorFile string? = nil
        internal var ExitCode int32? = nil
        internal var Failure string? = nil
        internal var Output string? = nil
        internal var Error string? = nil
        internal var OutputTruncated bool? = nil
        internal var ErrorTruncated bool? = nil

        internal func Element() JsonElement {
            using let bytes = MemoryStream()
            using let writer = Utf8JsonWriter(bytes)
            Write(writer)
            writer.Flush()
            bytes.Position = 0
            return J.Parse(bytes)
        }

        internal func Write(writer Utf8JsonWriter) {
            writer.WriteStartObject()
            writer.WritePropertyName("command")
            Command.WriteTo(writer)

            if let state = State {
                writer.WriteString("state", state)
            }

            if let path = OutputFile {
                writer.WriteString("output_file", path)
            }

            if let path = ErrorFile {
                writer.WriteString("error_file", path)
            }

            if let code = ExitCode {
                writer.WriteNumber("exit_code", code)
            }

            if State == "interrupted" {
                if let failure = Failure {
                    writer.WriteString("failure", failure)
                }
            }

            if let output = Output {
                writer.WriteString("output", output)
            }

            if let error = Error {
                writer.WriteString("error", error)
            }

            if let truncated = OutputTruncated {
                writer.WriteBoolean("output_truncated", truncated)
            }

            if let truncated = ErrorTruncated {
                writer.WriteBoolean("error_truncated", truncated)
            }

            if State != "interrupted" {
                if let failure = Failure {
                    writer.WriteString("failure", failure)
                }
            }

            writer.WriteEndObject()
        }

        shared {
            internal func Parse(value JsonElement) Result {
                const format string = "Verification result"
                let result = Result(JsonFields.Array(value, format, "command"))

                for word in result.Command.EnumerateArray() {
                    if word.ValueKind != JsonValueKind.String {
                        throw CliFailure("invalid_state", format + ": field \"command\" must contain strings")
                    }
                }

                result.State = J.Get(value, "state").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "state")
                result.OutputFile = J.Get(value, "output_file").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "output_file")
                result.ErrorFile = J.Get(value, "error_file").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "error_file")
                result.ExitCode = result.State != "completed" && J.Get(value, "exit_code")
                    .ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.Int32(value, format, "exit_code")
                result.Failure = J.Get(value, "failure").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "failure")
                result.Output = J.Get(value, "output").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "output")
                result.Error = J.Get(value, "error").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.String(value, format, "error")
                result.OutputTruncated = J.Get(value, "output_truncated").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.Bool(value, format, "output_truncated")
                result.ErrorTruncated = J.Get(value, "error_truncated").ValueKind == JsonValueKind.Undefined ? nil:
                JsonFields.Bool(value, format, "error_truncated")

                return result
            }
        }
    }

    shared {
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
            let name = "Verification " + (results.Count + 1).ToString() + ": " + Output.Prose(
                Output.Sink.Command(command)
            )
            let timing = progressBudget ?? budget ?? RuntimeBudget(Stopwatch.StartNew(), seconds)

            try {
                workspace?.CheckCancellation()

                var result CommandResult

                Output.Sink.Message(name, "cyan", true)
                {
                    using let progress = Output.Sink.Progress(
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

                Output.Sink.Message(
                    name + " - " + (result.Code == 0 ? "passed": "failed") + " (exit " + result.Code.ToString() +
                        "); " +
                        timing.Status(),
                    result.Code == 0 ? "green": "red",
                    true
                )

                return result
            } catch (error Exception) {
                Output.Sink.Message(
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

        internal func Results(run Data, record JsonElement) int32 {
            let checks = J.Items(J.Get(run.Element(), "verification"))
            let commands = J.Items(J.Get(J.Get(record, "policy"), "verification"))

            if checks.Count == 0 || checks.Count != commands.Count {
                throw ExecutionFailure.Create("verification_failed", "Missing independent verification results")
            }

            for i in 0 ... checks.Count {
                let check = Result.Parse(checks[i])

                if (check.State != nil && check.State != "" && check.State != "completed") || check.ExitCode != 0 {
                    throw ExecutionFailure.Create("verification_failed", "Owner verification did not pass")
                }

                if J.Write(check.Command) != J.Write(commands[i]) {
                    throw ExecutionFailure.Create("verification_failed", "Owner verification did not pass")
                }
            }

            return checks.Count
        }

        private func GitDirectory(path string, budget RuntimeBudget? = nil) {
            for entry in Directory.EnumerateFileSystemEntries(path) {
                budget?.Remaining()

                if FileInfo(entry).LinkTarget != nil {
                    throw ExecutionFailure.Create("invalid_state", "Verification refuses Git symlinks: " + entry)
                }

                if Directory.Exists(entry) {
                    GitDirectory(entry, budget)
                }
            }
        }

        internal func Validate(directory string, budget RuntimeBudget? = nil) string {
            let checkout = LocalPaths.DirectoryPath(directory)

            for root in[]string{"/home", "/run", "/var", "/tmp"} {
                if checkout == root {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Unsupported verification checkout layout: " + checkout
                    )
                }
            }

            for root in[]string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/dev", "/proc", "/sys", "/nix"} {
                if checkout == "/" || checkout == root || checkout.StartsWith(root + "/") {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Unsupported verification checkout layout: " + checkout
                    )
                }
            }

            let git = LocalPaths.DirectoryPath(Path.Combine(checkout, ".git"))
            GitDirectory(git, budget)

            for file in[]string{"commondir", "objects/info/alternates", "objects/info/http-alternates", "info/grafts"} {
                if File.Exists(Path.Combine(git, file)) || Directory.Exists(Path.Combine(git, file)) {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "Verification requires self-contained Git metadata: " + file
                    )
                }
            }

            return checkout
        }

        internal func Candidate(directory string, budget RuntimeBudget? = nil) string {
            let checkout = Validate(directory, budget)
            let evidence = budget?.Git(checkout, "ls-files", "-v", "-z") ?? Commands.Git(
                checkout,
                "ls-files",
                "-v",
                "-z"
            )

            for entry in evidence.Split('\0') {
                if entry != "" && (Char.IsLower(entry[0]) || entry[0] == 'S') {
                    throw Exception(
                        "Candidate index contains assume-unchanged or skip-worktree flags; inspect before continuing"
                    )
                }
            }

            return checkout
        }

        internal func Check(
            storage string,
            results List[Object],
            command JsonElement,
            directory string,
            seconds int32,
            budget RuntimeBudget? = nil
        ) CommandResult {
            let checkout = LocalPaths.DirectoryPath(directory)
            let root = LocalPaths.DirectoryPath(storage)

            if root == checkout || root.StartsWith(checkout + "/") {
                throw ExecutionFailure.Create(
                    "verification_failed",
                    "Verification evidence must be outside the checkout"
                )
            }

            let attempt = Path.Combine(root, "verification-" + Guid.NewGuid().ToString("N"))

            Directory.CreateDirectory(
                attempt,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )

            let outputPath = Path.Combine(attempt, "stdout.log")
            let errorPath = Path.Combine(attempt, "stderr.log")
            let check = Result(command)
            check.State = "running"
            check.OutputFile = Path.GetRelativePath(root, outputPath)
            check.ErrorFile = Path.GetRelativePath(root, errorPath)

            results.Add(check.Element())

            let record = Path.Combine(root, "verification.json")

            File.WriteAllText(record, J.Write(results))

            try {
                if seconds < 1 {
                    throw ExecutionFailure.Create("verification_failed", "Runtime budget exhausted before verification")
                }

                let words = List[string]()

                for word in J.Items(command) {
                    words.Add(word.GetString() ?? "")
                }

                let result = Run(checkout, words.ToArray(), seconds, outputPath, errorPath, budget)

                check.State = "completed"
                check.ExitCode = result.Code
                Evidence(check, result)
                results[results.Count - 1] = check.Element()

                File.WriteAllText(record, J.Write(results))

                return result
            } catch (error Exception) when error is CliFailure ||
                error is CommandInterrupted ||
                error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                check.ExitCode = nil
                check.State = "failed"
                check.Failure = error.Message

                if let result = Commands.InterruptedResult(error) {
                    check.State = "interrupted"
                    Evidence(check, result)
                }

                results[results.Count - 1] = check.Element()

                File.WriteAllText(record, J.Write(results))

                throw ExecutionFailure.From(error, "verification_failed")
            }
        }

        private func Evidence(check Result, result CommandResult) {
            check.Output = result.Output
            check.Error = result.Error
            check.OutputTruncated = result.OutputTruncated
            check.ErrorTruncated = result.ErrorTruncated
        }

        internal func Run(
            directory string,
            command[]string,
            seconds int32,
            outputPath string = "",
            errorPath string = "",
            budget RuntimeBudget? = nil
        ) CommandResult {
            let checkout = Validate(directory, budget)

            if command.Length == 0 {
                throw ExecutionFailure.Create("verification_failed", "Verification commands must be argv arrays")
            }

            for path in[]string{outputPath, errorPath} {
                if path != "" {
                    let parent = LocalPaths.DirectoryPath(Path.GetDirectoryName(Path.GetFullPath(path)) ?? "/")

                    if parent == checkout || parent.StartsWith(checkout + "/") {
                        throw ExecutionFailure.Create(
                            "verification_failed",
                            "Verification evidence must be outside the checkout"
                        )
                    }
                }
            }

            let cancellation = Chan[bool](1)
            let onCancel = ConsoleCancelEventHandler(
                (sender Object?, event ConsoleCancelEventArgs) -> {
                    event.Cancel = true
                    select {
                        case cancellation <- true { }
                        default { }
                    }
                }
            )

            Console.CancelKeyPress += onCancel

            try {
                let arguments = List[string](command)
                arguments.RemoveAt(0)
                var outputLine Action[string]? = nil
                var errorLine Action[string]? = nil
                if Output.Sink.Active() {
                    if outputPath != "" {
                        outputLine = line -> Output.Sink.Append(line)
                    }
                    if errorPath != "" {
                        errorLine = line -> Output.Sink.Append(line)
                    }
                }

                let result = Commands.Run(
                    command[0],
                    arguments.ToArray(),
                    checkout,
                    seconds: seconds,
                    cancellation: cancellation,
                    outputPath: outputPath,
                    errorPath: errorPath,
                    budget: budget,
                    outputLine: outputLine,
                    errorLine: errorLine
                )

                select {
                    case <- cancellation {
                        result.Code = nil
                        throw ExecutionFailure.From(
                            CommandInterrupted(
                                ExecutionFailure.Create("verification_failed", "Verification cancelled"),
                                result
                            ),
                            "verification_failed"
                        )
                    }
                    default { }
                }

                return result
            } finally {
                Console.CancelKeyPress -= onCancel
            }
        }
    }
}
