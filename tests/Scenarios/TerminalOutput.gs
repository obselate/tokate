package TokateTests

import System
import System.IO
import System.Text.Json.Nodes
import System.Text.RegularExpressions

internal class TerminalOutput {
    shared {
        private func Plain(text string) {
            for c in text {
                Check.That(!Char.IsControl(c) || c == '\n' || c == '\r', "Control sequence in plain human output")
            }
            Check.That(!text.Contains('☼') && !text.Contains('─'), "Plain output contains ornaments")
        }

        private func Checks(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Call([]string{"work", "--run", run})
            flow.Publish(run)
            flow.Reload()
            let name = "[red]literal[/]-" + String('n', 130) + "\u001b[31mcontrol\u001b[0m"
            let link = "https://example.test/check/" + String('u', 130)
            for state in[]string{"pass", "pending", "fail"} {
                let status = state == "pending" ? "in_progress": "completed"
                let conclusion = state == "pass" ? "success": (state == "fail" ? "failure": "")
                flow.State["check_runs"] = Check.Map(
                    "total_count",
                    2,
                    "check_runs",
                    JsonArray(
                        Check.Map("name", "verify", "status", status, "conclusion", conclusion, "html_url", link),
                        Check.Map("name", name, "status", status, "conclusion", conclusion, "html_url", link)
                    )
                )
                flow.Save()
                for width in[]int32{40, 80, 120} {
                    for background in[]string{"light", "dark"} {
                        flow.Temp.Env["TERM"] = "xterm-256color"
                        flow.Temp.Env["COLORTERM"] = "truecolor"
                        flow.Temp.Env["COLORFGBG"] = background == "light" ? "0;15": "15;0"
                        let result = TestTerminal.Pty(
                            binary,
                            []string{"checks", "--run", run, "--verbose"},
                            flow.Temp,
                            width
                        )
                        Check.That(
                            result.Code == (state == "pass" ? 0: (state == "pending" ? 8: 1)),
                            result.Output + result.Error
                        )
                        let visible = Regex.Replace(result.Output, "\\x1b\\[[0-?]*[ -/]*[@-~]", "")
                        Check.Contains(
                            visible,
                            "Checks " + (state == "pass" ? "passed": (state == "fail" ? "failed": state))
                        )
                        Check.Contains(result.Output, "[red]literal[/]-" + String('n', 130) + "control")
                        Check.Contains(result.Output, state)
                        Check.Contains(result.Output, "https://github.com/owner/project/pull/10")
                        Check.Contains(result.Output, link)
                        TestTerminal.Save(width.ToString() + "-" + background + "-checks-" + state, result.Output)
                    }
                }
            }
            let plain = TestTerminal.Pty(
                binary,
                []string{"checks", "--run", run, "--plain", "--verbose"},
                flow.Temp,
                40
            )
            Check.That(plain.Code == 1, plain.Output + plain.Error)
            Plain(plain.Output)
            Check.Contains(plain.Output, "Checks failed")
        }

        internal func All(binary string) {
            using let temp = Temp()
            let saved = Path.Combine(temp.Root, "saved with literal  spaces")
            Directory.CreateDirectory(saved)
            let identity = "donor-" + String('x', 150)
            let url = "https://github.com/owner/" + String('r', 100) + "/pull/42?view=complete"
            let untrusted = "[red]literal[/] \u001b[31mcontrol\u001b[0m \u001b]0;hidden-title\u0007 \u202esafe"
            File.WriteAllText(
                Path.Combine(saved, "run.json"),
                Check.Map(
                    "version",
                    2,
                    "repo",
                    "owner/project",
                    "issue",
                    28,
                    "approval",
                    "saved-approval-marker",
                    "base",
                    String('b', 40),
                    "state",
                    "failed",
                    "donor",
                    identity,
                    "pr_url",
                    url + untrusted,
                    "model",
                    untrusted,
                    "verification",
                    Check.Json("[{\"command\":[\"/bin/sh\",\"-c\",\"echo 'literal  spaces'\"],\"exit_code\":23}]"),
                    "failure_reason",
                    "verification_failed"
                )
                    .ToJsonString()
            )
            for width in[]int32{40, 80, 120} {
                for background in[]string{"light", "dark"} {
                    temp.Env["TERM"] = "xterm-256color"
                    temp.Env["COLORTERM"] = "truecolor"
                    temp.Env["LANG"] = "C.UTF-8"
                    temp.Env["COLORFGBG"] = background == "light" ? "0;15": "15;0"
                    for command in[]string{"help", "status", "doctor"} {
                        let argv = command == "status" ? []string{"status", "--run", saved}:
                        (command == "help" ? []string{"help", "work"}: []string{"doctor", "managed"})
                        let result = TestTerminal.Pty(binary, argv, temp, width)
                        Check.That(result.Code == (command == "doctor" ? 1: 0), result.Output + result.Error)
                        Check.That(command == "status" || result.Output.Contains("Tokate"), "Missing heading")
                        Check.Contains(result.Output, "\u001b[")
                        if command == "status" {
                            Check.Contains(result.Output, url)
                            Check.Contains(result.Output, "[red]literal[/]")
                            Check.Contains(result.Output, "control")
                            Check.That(
                                !result.Output.Contains("hidden-title") && !result.Output.Contains('\u202e'),
                                "Untrusted terminal controls survived"
                            )
                            Check.That(
                                !result.Output.Contains("saved-approval-marker") && !result.Output.Contains(
                                    "Artifacts:"
                                ),
                                "Human status dumped receipt or artifact metadata"
                            )
                        }
                        TestTerminal.Save(width.ToString() + "-" + background + "-" + command, result.Output)
                    }
                }
                let rootHelp = TestTerminal.Pty(binary, []string{"--help"}, temp, width)
                Check.That(rootHelp.Code == 0, rootHelp.Output + rootHelp.Error)
                Check.Contains(rootHelp.Output, "amend")
                TestTerminal.Save(width.ToString() + "-help", rootHelp.Output)
                let ascii = TestTerminal.Pty(binary, []string{"help", "work", "--ascii"}, temp, width)
                Check.That(ascii.Code == 0, ascii.Output + ascii.Error)
                Check.Contains(ascii.Output, "* ")
                Check.That(
                    !ascii.Output.Contains('☼') && !ascii.Output.Contains('─'),
                    "ASCII ornaments contain Unicode"
                )
                TestTerminal.Save(width.ToString() + "-ascii", ascii.Output)
                temp.Env["TERM"] = "linux"
                temp.Env["COLORTERM"] = ""
                let limited = TestTerminal.Pty(binary, []string{"help", "work", "--ascii"}, temp, width)
                Check.That(limited.Code == 0, limited.Output + limited.Error)
                Check.That(
                    !limited.Output.Contains("38;2;") && !limited.Output.Contains("38;5;"),
                    "Limited terminal received extended colors"
                )
                TestTerminal.Save(width.ToString() + "-limited", limited.Output)
                temp.Env["TERM"] = "xterm-256color"
                temp.Env["COLORTERM"] = "truecolor"
                let plain = TestTerminal.Pty(binary, []string{"status", "--run", saved, "--plain"}, temp, width)
                Check.That(plain.Code == 0, plain.Output + plain.Error)
                Plain(plain.Output)
                Check.Contains(plain.Output, url)
                TestTerminal.Save(width.ToString() + "-plain", plain.Output)
                temp.Env["NO_COLOR"] = ""
                let noColor = TestTerminal.Pty(binary, []string{"status", "--run", saved}, temp, width)
                Check.That(noColor.Code == 0, noColor.Output + noColor.Error)
                Plain(noColor.Output)
                TestTerminal.Save(width.ToString() + "-no-color", noColor.Output)
                temp.Env.Remove("NO_COLOR")
                temp.Env["TERM"] = "dumb"
                let dumb = TestTerminal.Pty(binary, []string{"status", "--run", saved}, temp, width)
                Check.That(dumb.Code == 0, dumb.Output + dumb.Error)
                Plain(dumb.Output)
                Check.Contains(dumb.Output, "State  failed: Independent verification failed.")
                TestTerminal.Save(width.ToString() + "-dumb", dumb.Output)
                temp.Env["TERM"] = "xterm-256color"
                let json = TestTerminal.Pty(
                    binary,
                    []string{"status", "--run", saved, "--plain", "--ascii", "--json"},
                    temp,
                    width
                )
                let envelope = Check.Envelope(json, "status", "ok")
                Check.That(Check.Text(envelope["data"]?["model"]) == untrusted, "Presentation changed JSON data")
                TestTerminal.Save(width.ToString() + "-json", json.Output)
            }
            temp.Env["TERM"] = "xterm-256color"
            let redirected = TestProcess.Run(binary, []string{"status", "--run", saved, "--plain"}, temp.Env)
            Check.Success(redirected)
            Plain(redirected.Output)
            Check.Contains(redirected.Output, "State  failed")
            TestTerminal.Save("redirected", redirected.Output)
            let recordPath = Path.Combine(saved, "run.json")
            let record = Check.Json(File.ReadAllText(recordPath))
            record["version"] = JsonValue.Create(2)
            record["source"] = JsonValue.Create("tokate")
            record["state"] = JsonValue.Create("generated")
            File.WriteAllText(recordPath, record.ToJsonString())
            let correctionPath = Path.Combine(saved, "correction.json")
            File.WriteAllText(
                correctionPath,
                Check.Map(
                    "state",
                    "failed",
                    "failure_reason",
                    "verification_failed",
                    "error",
                    "private-correction-marker"
                )
                    .ToJsonString()
            )
            let generated = TestProcess.Run(binary, []string{"status", "--run", saved, "--plain"}, temp.Env)
            Check.Success(generated)
            Check.Contains(generated.Output, "Next   tokate submit --run")
            Check.That(!generated.Output.Contains("--json"), "Human action selected machine output")
            Check.Contains(generated.Output, "State  generated, correction failed: Independent verification failed.")
            Check.That(
                !generated.Output.Contains("private-correction-marker"),
                "Correction status leaked private evidence"
            )
            File.Delete(correctionPath)
            record["state"] = JsonValue.Create("verifying")
            record["verification"] = JsonArray()
            let snapshot = record.ToJsonString()
            File.WriteAllText(recordPath, snapshot)
            let path = temp.Env["PATH"]
            temp.Env["PATH"] = ""
            let verifying = TestProcess.Run(binary, []string{"status", "--run", saved, "--plain"}, temp.Env)
            Check.Success(verifying)
            Check.Contains(verifying.Output, "State  verifying")
            Check.Contains(verifying.Output, "Next   none")
            Check.That(File.ReadAllText(recordPath) == snapshot, "Status changed saved evidence")
            temp.Env["PATH"] = path
            let invalid = TestTerminal.Pty(
                binary,
                []string{"work", "--plain", "--bad-[red]literal[/]\u001b[31mcontrol\u001b[0m"},
                temp,
                40
            )
            Check.That(invalid.Code == 1, "Invalid option did not fail")
            Plain(invalid.Output)
            Check.Contains(invalid.Output, "[red]literal[/]control")
            Checks(binary)
            ProgressChecks.All(binary)
            Console.WriteLine(
                "PASS terminal output: 40/80/120 columns, light/dark, plain/ASCII/NO_COLOR/dumb/redirected/JSON, full identities/URLs and untrusted controls"
            )
        }
    }
}
