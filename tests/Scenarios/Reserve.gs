package TokateTests

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json.Nodes

internal class ReserveChecks {
    shared {
        internal func All(binary string) {
            using let test = CoordinationFixture(binary)
            let run = Prepare(test)
            using let baseline = FixtureSnapshot(test.Flow.Temp.Root)
            for mode in[]string{"success", "timeout", "slow_candidate", "empty", "workflow"} {
                baseline.Restore()
                test.Flow.Reload()
                Managed(test.Flow, run, mode)
            }
            Limits(binary)
        }

        private func Prepare(v2 CoordinationFixture) string {
            let flow = v2.Flow
            v2.Initialize(false)
            flow.VerificationPolicy("sleep 3; test -f result.txt", second: "sleep 1; test -f result.txt")
            flow.Approve()
            v2.Claim()
            v2.Prepare(reserve: "1", code: 1)
            File.WriteAllText(
                v2.Tools,
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
            )
            for reserve in[]string{"0", "bad", "30"} {
                v2.Prepare("tokate", code: 1, reserve: reserve)
            }
            Check.That(!Directory.Exists(Path.Combine(flow.Temp.Root, "runs")), "Invalid v2 allocation wrote a run")
            flow.NoInference()
            return v2.Prepare("tokate", seconds: "8", reserve: "2")
        }

        private func Managed(flow NativeFixture, run string, mode string) {
            let before = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.That(
                Check.Text(before["seconds"]) == "8" && Check.Text(before["verification_reserve"]) == "2",
                "Allocation not saved"
            )
            flow.Mode(mode == "success" ? "": mode)
            let result = flow.Call([]string{"work", "--run", run}, mode == "success" ? 0: 1)
            flow.Reload()
            let elapsed = Stopwatch.GetElapsedTime(Int64.Parse(Check.Text(flow.State["exec_start"])))
            Check.Contains(result.Error, "total allowance 8s, coding allowance 6s, verification reserve 2s")
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.Contains(
                Check.Text(flow.State["prompts"]?[0]),
                "total allowance 8s, coding allowance 6s, verification reserve 2s"
            )
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Reserve launched more than one inference")
            if mode == "success" {
                Check.That((saved["verification"]?.AsArray().Count ?? 0) == 2, "Original checks did not all run")
                Check.That(elapsed.TotalSeconds >= 4.0, "Unused coding time was not available to verification")
                return
            }
            Check.That(Check.Text(saved["state"]) == "failed", "Failure became success")
            Check.That(
                !File.Exists(Path.Combine(run, "verification.json")),
                "Verification ran after coding/candidate failure"
            )
            flow.NoPr()
            if mode == "timeout" {
                Check.That(elapsed.TotalSeconds >= 5.5, "Coding allowance expired early")
                Check.That(
                    saved["turn_completed"] == nil && saved["usage"] == nil && saved["inference_exit_code"] == nil,
                    "Timeout fabricated completion"
                )
                Check.That(
                    File.ReadAllText(Path.Combine(run, "checkout/partial.txt")) == "partial-edit",
                    "Partial checkout lost"
                )
                Check.Contains(File.ReadAllText(Path.Combine(run, "events.jsonl")), "partial-secret")
                Check.Contains(File.ReadAllText(Path.Combine(run, "stderr.log")), "synthetic-partial-stderr-secret")
                let pid = File.ReadAllText(Path.Combine(flow.Bin, "child.pid"))
                TestProcess.Collected(pid, "Timeout descendant survived")
                flow.Call([]string{"amend", "--yes", "--run", run}, 1)
                flow.Call([]string{"submit", "--yes", "--run", run}, 1)
            } else {
                Check.That(
                    Check.Text(saved["turn_completed"]) == "true" && Check.Text(
                        saved["failure_stage"]
                    ) == "candidate_validation",
                    "Actual candidate outcome lost"
                )
                if mode == "slow_candidate" {
                    Check.That(
                        elapsed.TotalSeconds >= 5.5 && elapsed.TotalSeconds < 7.0,
                        "Candidate overhead consumed reserve"
                    )
                }
            }
            flow.Call([]string{"work", "--run", run}, 1)
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Failed reserve run retried inference")
            flow.NoPr()
        }

        private func Limits(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            let path = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            policy["max_seconds"] = JsonValue.Create(5)
            File.WriteAllText(path, policy.ToJsonString())
            flow.Commit("Lower owner total")
            flow.Git("-C", Path.Combine(flow.Bin, "fork"), "fetch", flow.Upstream, "main")
            flow.Approve()
            for reserve in[]string{"0", "bad"} {
                flow.Claim(seconds: "5", reserve: reserve, code: 1)
            }
            for command in[]string{"external", "amend"} {
                Check.Contains(
                    flow.Call([]string{command, "--run", flow.Temp.Root, "--verify-time", "1s"}, 1).Error,
                    "Unknown option for " + command + ": --verify-time"
                )
            }
            Check.Contains(
                flow.Call([]string{"work", "--run", flow.Temp.Root, "--verify-time", "1s"}, 1).Error,
                "--run conflicts with --verify-time"
            )
            let args = []string{
                "claim",
                "--yes",
                "owner/project#1",
                "--model",
                "gpt-6.1-sol",
                "--effort",
                "high",
                "--time",
                "5s",
                "--verify-time",
                "5s",
                "--runs",
                Path.Combine(flow.Temp.Root, "runs")
            }
            Check.Contains(flow.Call(args, 1).Error, "--verify-time must be shorter than --time")
            flow.Claim(seconds: "6", reserve: "1", code: 1)
            Check.That(!Directory.Exists(Path.Combine(flow.Temp.Root, "runs")), "Lower owner limit wrote invalid claim")
            Check.That(
                flow.Git(
                    "-C",
                    Path.Combine(flow.Bin, "fork"),
                    "for-each-ref",
                    "--format=%(refname)",
                    "refs/heads/tokate"
                ) == "",
                "Invalid reserve wrote claim refs"
            )
            flow.NoInference()
            let work = List[string](args)
            work[0] = "work"
            work[work.IndexOf("--verify-time") + 1] = "1s"
            work.Add("--json")
            let saved = Check.Json(flow.Acquire(work.ToArray()).Output)["data"]
            Check.That(
                Check.Text(saved?["seconds"]) == "5" && Check.Text(saved?["coding_seconds"]) == "4" && Check.Text(
                    saved?["verification_reserve"]
                ) == "1",
                "Reserve changed explicit total"
            )
        }
    }
}
