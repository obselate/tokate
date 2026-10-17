package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Verification {
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

        internal func Results(run Data, verification JsonElement) int32 {
            let checks = J.Items(J.Get(run.Element(), "verification"))
            let commands = J.Items(verification)

            if checks.Count == 0 || checks.Count != commands.Count {
                throw ExecutionFailure.Create("verification_failed", "Missing independent verification results")
            }

            for i in 0 ... checks.Count {
                var code int32
                let check = checks[i]
                let exitCode = J.Get(check, "exit_code")
                let state = J.Text(check, "state")

                if (state != "" && state != "completed") ||
                    exitCode.ValueKind != JsonValueKind.Number ||
                    !exitCode.TryGetInt32(out code) || code != 0 {
                    throw ExecutionFailure.Create("verification_failed", "Owner verification did not pass")
                }

                if J.Write(J.Get(check, "command")) != J.Write(commands[i]) {
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
            let check = map[string, Object?]{
                "command": command,
                "state": "running",
                "output_file": Path.GetRelativePath(root, outputPath),
                "error_file": Path.GetRelativePath(root, errorPath)
            }

            results.Add(check)

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

                check["state"] = "completed"
                check["exit_code"] = result.Code
                Evidence(check, result)

                File.WriteAllText(record, J.Write(results))

                return result
            } catch (error Exception) when error is CliFailure ||
                error is CommandInterrupted ||
                error.GetType() == typeof(Exception) ||
                error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                check.Remove("exit_code")
                check["state"] = "failed"
                check["failure"] = error.Message

                if let result = Commands.InterruptedResult(error) {
                    check["state"] = "interrupted"
                    Evidence(check, result)
                }

                File.WriteAllText(record, J.Write(results))

                throw ExecutionFailure.From(error, "verification_failed")
            }
        }

        private func Evidence(check Dictionary[string, Object?], result CommandResult) {
            check["output"] = result.Output
            check["error"] = result.Error
            check["output_truncated"] = result.OutputTruncated
            check["error_truncated"] = result.ErrorTruncated
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
