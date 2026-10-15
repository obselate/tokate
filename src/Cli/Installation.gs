package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.Runtime.ExceptionServices

internal class Installation {
    shared {
        internal func Run(options Args) int32 {
            if MachineSetup.NixManaged() {
                throw CliFailure(
                    "invalid_state",
                    "Nix manages this installation. Use nix profile upgrade/remove or update your NixOS configuration."
                )
            }

            let command = options.Command
            let path = Environment.ProcessPath ?? ""
            let shell = LocalPaths.NeedSystemTool("sh")
            let script = ApplicationInfo.Resource("install.sh")
            let preview = List[string]()
            let checked = Execute(shell, []string{"-s", "--", command, path, "preview"}, script, true, lines: preview)

            if checked != 0 {
                return checked
            }

            let version = ApplicationInfo.Version()
            let result = map[string, Object?]{
                "version": version,
                "installation": command,
                "path": path,
                "applied": false
            }
            PublicOutput.ResultData = result

            if command == "update" {
                result["target_version"] = preview[0]
                Terminal.Message("Update Tokate " + version + " to " + preview[0] + " at " + path + ".", "yellow", true)
            } else {
                result["removes"] = preview
                result["keeps"] = LocalPaths.StateDirectory()
                Terminal.Message(
                    "Remove " + String.Join(", ", preview) + ". Keep saved runs in " + LocalPaths.StateDirectory() +
                        ".",
                    "yellow",
                    true
                )
            }

            if !OwnerSetup.Confirm(options, command == "update" ? "Update Tokate?": "Uninstall Tokate?") {
                if OwnerSetup.Unattended(options) {
                    return 0
                }
                throw CliFailure("confirmation_required", "Pass --yes to " + command + " Tokate. Nothing changed.")
            }

            let code = Execute(
                shell,
                []string{"-s", "--", command, path, command == "update" ? "v" + preview[0]: ""},
                script
            )
            result["applied"] = code == 0
            return code
        }

        internal func Execute(
            executable string,
            args[]string,
            input string? = nil,
            capture bool = false,
            pathVariables[]string = nil,
            lines List[string]? = nil
        ) int32 {
            let info = ProcessStartInfo(executable)

            info.UseShellExecute = false
            info.RedirectStandardInput = input != nil
            info.RedirectStandardOutput = PublicOutput.Enabled || capture
            info.RedirectStandardError = PublicOutput.Enabled || capture

            for arg in args {
                info.ArgumentList.Add(arg)
            }

            info.Environment.Clear()

            for key in[]string{
                "HOME",
                "PATH",
                "SHELL",
                "LANG",
                "TERM",
                "ZDOTDIR",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "TMPDIR"
            } {
                if let value = Environment.GetEnvironmentVariable(key) {
                    info.Environment[key] = value
                }
            }

            for key in pathVariables ?? []string{} {
                let path = Environment.GetEnvironmentVariable(key) ?? ""
                if path != "" {
                    info.Environment[key] = LocalPaths.RuntimePath(path)
                }
            }

            let started = Chan[Process?](1)
            let exited = Chan[Exception?](1)
            let output = Chan[CommandOutput](1)
            let error = Chan[CommandOutput](1)
            let failed = Chan[Exception](4)

            go Commands.Wait(info, started, exited)

            let launched = <-started

            if launched == nil {
                throw <-exited ?? Exception("Cannot start the installer")
            }

            using let process = launched
            let cancel = ConsoleCancelEventHandler(
                (sender Object?, event ConsoleCancelEventArgs) -> {
                    event.Cancel = true
                    try {
                        if !process.HasExited {
                            process.Kill(true)
                        }
                    } catch (failure Exception) { }
                }
            )
            Console.CancelKeyPress += cancel

            var outputStarted bool
            var errorStarted bool
            var exitDone bool
            var terminal Exception? = nil
            var stdout = CommandOutput()
            var stderr = CommandOutput()

            try {
                if info.RedirectStandardOutput {
                    go Commands.Read(process.StandardOutput, output, failed)
                    outputStarted = true
                }

                if info.RedirectStandardError {
                    go Commands.Read(process.StandardError, error, failed)
                    errorStarted = true
                }

                if input != nil {
                    process.StandardInput.Write(input)
                    process.StandardInput.Close()
                }

                select {
                    case let failure = <- exited {
                        terminal = failure
                        exitDone = true
                    }

                    case let failure = <- failed {
                        throw failure
                    }
                }
            } catch (failure Exception) {
                terminal = failure
            } finally {
                Console.CancelKeyPress -= cancel

                try {
                    if !process.HasExited {
                        try {
                            process.Kill(true)
                        } catch (failure InvalidOperationException) { }
                    }

                    process.WaitForExit()
                } catch (failure Exception) {
                    terminal = terminal ?? failure
                }

                if !exitDone {
                    let failure = <-exited

                    terminal = terminal ?? failure
                }

                try {
                    if info.RedirectStandardInput {
                        process.StandardInput.Close()
                    }
                } catch (failure Exception) {
                    terminal = terminal ?? failure
                }

                if outputStarted {
                    stdout = <-output
                }

                if errorStarted {
                    stderr = <-error
                }
            }

            if let failure = terminal {
                ExceptionDispatchInfo.Capture(failure).Throw()
            }

            if outputStarted || errorStarted {
                if stdout.Failure != nil || stderr.Failure != nil {
                    throw CliFailure("command_failed", "Cannot read installer diagnostics")
                }

                PublicOutput.Truncated = PublicOutput.Truncated || stdout.Truncated || stderr.Truncated
                if let output = lines {
                    output.AddRange(stdout.Text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                } else {
                    Console.Error.Write(PublicOutput.Prose(stdout.Text))
                }
                Console.Error.Write(PublicOutput.Prose(stderr.Text))
            }

            return process.ExitCode
        }
    }
}
