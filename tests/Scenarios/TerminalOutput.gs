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

        private func Interactive(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            flow.Git("init", "-b", "main", flow.Temp.Root)
            flow.Git("-C", flow.Temp.Root, "remote", "add", "origin", "https://github.com/inferred/project.git")
            flow.Reload()
            let issue = flow.State["issue"] ?? throw Exception("Missing fixture issue")
            issue["title"] = JsonValue.Create(
                String('x', 6) + Char.ConvertFromUtf32(0x1f331) +
                    "[red]literal[/]\u001b[31mcontrol\u001b[0m" +
                    String('x', 100)
            )
            flow.Save()
            flow.Temp.Env["TERM"] = "dumb"
            flow.ResetTraffic()
            let result = TestTerminal.Pty(
                binary,
                []string{},
                flow.Temp,
                20,
                "?\n1\nhttps://github.com/owner/project/issues/0\nowner/project\nq\n"
            )
            Check.Success(result)
            Plain(result.Output)
            Check.Contains(result.Output, "Donate AI time")
            Check.Contains(result.Output, "Set up my project")
            Check.Contains(result.Output, "Continue existing work")
            Check.Contains(result.Output, "[inferred/project]")
            Check.Contains(result.Output, "positive number")
            Check.Contains(result.Output, "[red]literal[/]control")
            Check.That(!result.Output.Contains('\ufffd'), "Terminal summary split a Unicode surrogate pair")
            flow.Reload()
            var reads int32
            for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "Interactive menu wrote to GitHub")
                let path = Check.Text(call["path"])
                Check.That(!path.Contains("inferred/project"), "Inferred repository was used before confirmation")
                Check.That(
                    !path.Contains("/pulls") && !path.Contains("/check-runs"),
                    "Issue selection fetched unrelated PR or check histories"
                )
                reads++
            }
            Check.That(reads == 1, "Issue selection should read only the approved issue index")
            flow.NoInference()
            TestTerminal.Save("20-interactive", result.Output)
            flow.Git("-C", flow.Temp.Root, "remote", "add", "upstream", "https://github.com/other/project.git")
            flow.ResetTraffic()
            let canceled = TestTerminal.Pty(binary, []string{}, flow.Temp, 40, "1\nq\n")
            Check.Success(canceled)
            Check.That(!canceled.Output.Contains("Ambiguous"), "Optional inference displayed a command-line error")
            flow.Reload()
            Check.That((flow.State["api_calls"]?.AsArray().Count ?? 0) == 0, "Canceled selection read GitHub")
            flow.NoInference()
            flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
            let canceledIssue = TestTerminal.Pty(
                binary,
                []string{"approve", "owner/project"},
                flow.Temp,
                80,
                "?\nCanceled title\n?\nCanceled description\n\n?\n2\n"
            )
            Check.Success(canceledIssue)
            Check.Contains(canceledIssue.Output, "Create and approve")
            Check.Contains(canceledIssue.Output, "Cancel")
            Check.Contains(
                canceledIssue.Output.Substring(0, canceledIssue.Output.IndexOf("tokate / Describe the issue")),
                "Tokate creates this GitHub issue and approves it for donors in one step. Enter a short title, then describe the task."
            )
            Check.Contains(
                canceledIssue.Output.Substring(canceledIssue.Output.IndexOf("tokate / Describe the issue")),
                "Tokate creates this GitHub issue and approves it for donors in one step. Enter a short title, then describe the task."
            )
            Check.Contains(
                canceledIssue.Output,
                "Create and approve opens the issue and approves it for donors. Cancel creates nothing."
            )
            flow.Reload()
            Check.That((flow.State["api_calls"]?.AsArray().Count ?? 0) == 0, "Canceled issue creation called GitHub")
            for args in[]([]string){
                []string{"approve", "owner/project", "--json"},
                []string{"approve", "owner/project", "--non-interactive"},
                []string{"approve", "owner/project#1", "--title", "Conflicting title"},
                []string{
                    "approve",
                    "owner/project",
                    "--title",
                    "Conflicting body",
                    "--body",
                    "Text",
                    "--body-file",
                    "missing"
                }
            } {
                let invalid = TestTerminal.Pty(binary, args, flow.Temp, 80)
                Check.That(invalid.Code == 1, invalid.Output + invalid.Error)
            }
            flow.Reload()
            Check.That((flow.State["api_calls"]?.AsArray().Count ?? 0) == 0, "Invalid creation called GitHub")
            let description = "Literal description: $(touch injected) [red]text[/]\nSecond line.\n"
            let bodyFile = Path.Combine(flow.Temp.Root, "issue-body.txt")
            File.WriteAllText(bodyFile, description)
            for mode in[]string{"body", "body-file", "interactive", "interactive-rich", "wizard"} {
                flow.Temp.Env["TERM"] = mode == "interactive-rich" ? "xterm-256color": "dumb"
                let title = "New issue from " + mode
                var result Result
                if mode == "body" || mode == "body-file" {
                    result = TestTerminal.Pty(
                        binary,
                        []string{
                            "approve",
                            "owner/project",
                            "--title",
                            title,
                            "--" + mode,
                            mode == "body" ? description: bodyFile,
                            mode == "body" ? "--non-interactive": "--json"
                        },
                        flow.Temp,
                        80
                    )
                } else {
                    result = TestTerminal.Pty(
                        binary,
                        mode == "wizard" ? []string{}: []string{"approve", "owner/project"},
                        flow.Temp,
                        80,
                        (mode == "wizard" ? "4\nowner/project\n": "") +
                            title +
                            "\nFirst line.\nSecond line.\n\n" +
                            (mode == "interactive-rich" ? "\n": "1\n") +
                            "?\nbad..branch\n\n" +
                            (mode == "wizard" ? "\nq\n": "")
                    )
                    Check.Contains(result.Output, "Title: " + title)
                    Check.Contains(result.Output, "Description:")
                    Check.Contains(result.Output, "Create and approve")
                    Check.Contains(result.Output, "tokate / Target branch")
                    Check.Contains(result.Output, "Enter a Git branch name, or press Enter to keep the default.")
                    Check.Contains(result.Output, "Expected a Git branch name")
                }
                Check.Success(result)
                flow.Reload()
                let issues = flow.State["issues"]?.AsObject() ?? throw Exception("Missing created issues")
                let number = issues.Count.ToString()
                let created = issues[number] ?? throw Exception("Missing created issue")
                Check.That(Check.Text(created["title"]) == title, "Created title changed")
                Check.That(
                    Check.Text(created["body"]) == (
                        mode == "body" || mode == "body-file" ? description: "First line.\nSecond line."
                    ),
                    "Created description changed"
                )
                Check.That(
                    Check.Text(created["labels"]?[0]?["name"]) == "tokate:approved",
                    "Created issue lacks approval label"
                )
                let state = Check.Json(flow.Call([]string{"coordination", "owner/project#" + number}).Output)
                Check.That(Check.Text(state["state"]?["issue"]) == number, "Creation did not record approval")
                let url = "https://github.com/owner/project/issues/" + number
                Check.Contains(result.Output, url)
                if mode != "body-file" {
                    let output = Regex
                        .Replace(result.Output, "\\x1b\\[[0-?]*[ -/]*[@-~]", "")
                        .Replace("\r\n", " ")
                        .Replace('\n', ' ')
                    Check.Contains(
                        output,
                        "Approved " + url + ". Donors start with: tokate work owner/project#" + number
                    )
                    Check.That(
                        Check.Text(state["state"]?["approval"]?["base_branch"]) == "main",
                        "Approval did not keep the default target branch"
                    )
                }
                if mode == "interactive-rich" {
                    Check.Contains(
                        Regex.Replace(
                            result.Output.Substring(result.Output.IndexOf("Review issue")),
                            "\\x1b\\[[0-9;]*m",
                            ""
                        ),
                        "\x1b[H\x1b[2JLoading next step...\x1b[K\r\n"
                    )
                    let closed = result.Output.IndexOf("\x1b[?1049l")
                    Check.That(
                        closed >= 0 && closed < result.Output.IndexOf(url),
                        "Issue URL was hidden in the wizard screen"
                    )
                }
                if mode == "body-file" {
                    let data = Check.Json(result.Output)["data"]
                    Check.That(Check.Text(data?["issue"]) == number, "JSON lacks the created issue number")
                    Check.That(Check.Text(data?["issue_url"]) == url, "JSON lacks the created issue URL")
                }
            }
            Check.That(!File.Exists(Path.Combine(flow.Temp.Root, "injected")), "Issue description executed shell text")
            flow.NoInference()
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
                    url,
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
                        Check.Contains(result.Output, "Tokate")
                        Check.Contains(result.Output, "\u001b[")
                        if command == "status" {
                            Check.Contains(result.Output, identity)
                            Check.Contains(result.Output, url)
                            Check.Contains(result.Output, saved)
                            Check.Contains(result.Output, "[red]literal[/]")
                            Check.Contains(result.Output, "control")
                            Check.That(
                                !result.Output.Contains("hidden-title") && !result.Output.Contains('\u202e'),
                                "Untrusted terminal controls survived"
                            )
                            Check.Contains(result.Output, "Exit code: 23")
                            Check.Contains(result.Output, "literal  spaces")
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
                Check.Contains(rootHelp.Output, "authorize-sync")
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
                Check.Contains(plain.Output, identity)
                Check.Contains(plain.Output, url)
                Check.Contains(plain.Output, saved)
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
                Check.Contains(dumb.Output, "State: failed")
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
            Check.Contains(redirected.Output, "Donor run")
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
            Check.Contains(generated.Output, "Next: tokate submit --run")
            Check.That(generated.Output.IndexOf("Next:") < generated.Output.IndexOf("State:"), "Action was not first")
            for line in generated.Output.Split('\n') {
                if line.StartsWith("Next:") {
                    Check.That(!line.Contains("--json"), "Human action selected machine output")
                }
            }
            Check.Contains(generated.Output, "Details: tokate status --run")
            Check.Contains(generated.Output, "Correction: failed")
            Check.Contains(generated.Output, "Correction error:")
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
            Check.Contains(verifying.Output, "State: verifying")
            Check.Contains(verifying.Output, "Verification: no result recorded")
            Check.That(
                !verifying.Output.Contains("Next:") && !verifying.Output.Contains("Error:"),
                "Invented action or failure"
            )
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
            Interactive(binary)
            Checks(binary)
            ProgressChecks.All(binary)
            Console.WriteLine(
                "PASS terminal output: 40/80/120 columns, light/dark, plain/ASCII/NO_COLOR/dumb/redirected/JSON, full identities/URLs and untrusted controls"
            )
        }
    }
}
