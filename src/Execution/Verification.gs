package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Verification {
    shared {
        internal func Results(run Data, record JsonElement) int32 {
            let checks = J.Items(J.Get(run.Element(), "verification"))
            let commands = J.Items(J.Get(J.Get(record, "policy"), "verification"))
            if checks.Count == 0 || checks.Count != commands.Count {
                throw Exception("Missing independent verification results")
            }
            for i in 0 ... checks.Count {
                var code int32
                let check = checks[i]
                let exitCode = J.Get(check, "exit_code")
                let state = J.Text(check, "state")
                if (state != "" && state != "completed") ||
                    exitCode.ValueKind != JsonValueKind.Number ||
                    !exitCode.TryGetInt32(out code) || code != 0 {
                    throw Exception("Owner verification did not pass")
                }
                if J.Write(J.Get(check, "command")) != J.Write(commands[i]) {
                    throw Exception("Owner verification did not pass")
                }
            }
            return checks.Count
        }

        private func GitDirectory(path string, budget RuntimeBudget? = nil) {
            for entry in Directory.EnumerateFileSystemEntries(path) {
                budget?.Remaining()
                if FileInfo(entry).LinkTarget != nil {
                    throw Exception("Verification refuses Git symlinks: " + entry)
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
                    throw Exception("Unsupported verification checkout layout: " + checkout)
                }
            }
            for root in[]string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/dev", "/proc", "/sys", "/nix"} {
                if checkout == "/" || checkout == root || checkout.StartsWith(root + "/") {
                    throw Exception("Unsupported verification checkout layout: " + checkout)
                }
            }
            let git = LocalPaths.DirectoryPath(Path.Combine(checkout, ".git"))
            GitDirectory(git, budget)
            for file in[]string{"commondir", "objects/info/alternates", "objects/info/http-alternates", "info/grafts"} {
                if File.Exists(Path.Combine(git, file)) || Directory.Exists(Path.Combine(git, file)) {
                    throw Exception("Verification requires self-contained Git metadata: " + file)
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
                throw Exception("Verification evidence must be outside the checkout")
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
                    throw Exception("Runtime budget exhausted before verification")
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
            } catch (error Exception) {
                check.Remove("exit_code")
                check["state"] = "failed"
                check["failure"] = error.Message
                if let result = Commands.InterruptedResult(error) {
                    check["state"] = "interrupted"
                    Evidence(check, result)
                }
                File.WriteAllText(record, J.Write(results))
                throw error
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
                throw Exception("Verification commands must be argv arrays")
            }
            for path in[]string{outputPath, errorPath} {
                if path != "" {
                    let parent = LocalPaths.DirectoryPath(Path.GetDirectoryName(Path.GetFullPath(path)) ?? "/")
                    if parent == checkout || parent.StartsWith(checkout + "/") {
                        throw Exception("Verification evidence must be outside the checkout")
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
                if DonationView.Active() {
                    if outputPath != "" {
                        outputLine = line -> DonationView.Append(line)
                    }
                    if errorPath != "" {
                        errorLine = line -> DonationView.Append(line)
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
                        throw CommandInterrupted(Exception("Verification cancelled"), result)
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
