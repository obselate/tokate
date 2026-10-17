package TokateTests

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json.Nodes

internal class VerificationChecks {
    shared {
        internal func All(binary string) {
            Layouts(binary)
            Records(binary)
        }

        private func Layouts(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("verification_fail")
            Check.Contains(flow.Call([]string{"work", "--yes", "--run", run}, 1).Error, "Owner verification failed")
            flow.Call([]string{"amend", "--yes", "--run", run})
            let commit = AmendmentFlow.Correct(flow, run)
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for mode in[]string{
                "checkout-link",
                "git-link",
                "git-file",
                "git-child-link",
                "alternates",
                "http-alternates",
                "commondir"
            } {
                baseline.Restore()
                let checkout = Path.Combine(run, "checkout")
                let git = Path.Combine(checkout, ".git")
                let sentinel = Path.Combine(flow.Temp.Root, "private-layout")
                File.WriteAllText(sentinel, "synthetic-private-configuration")
                let evidence = File.ReadAllText(Path.Combine(run, "verification.json"))
                var reason = "Git symlinks"
                if mode == "checkout-link" || mode == "git-link" {
                    let path = mode == "checkout-link" ? checkout: git
                    Directory.Move(path, path + "-real")
                    Directory.CreateSymbolicLink(path, path + "-real")
                    reason = "real directories without checkout/Git symlinks"
                } else if mode == "git-file" {
                    Directory.Delete(git, true)
                    File.WriteAllText(git, "gitdir: " + sentinel)
                    reason = "real directories"
                } else if mode == "git-child-link" {
                    File.Delete(Path.Combine(git, "config"))
                    File.CreateSymbolicLink(Path.Combine(git, "config"), sentinel + "-missing")
                } else {
                    PublishedContribution.Write(git, mode == "commondir" ? mode: "objects/info/" + mode, flow.Temp.Root)
                    reason = "self-contained Git metadata"
                }
                Check.Contains(AmendmentFlow.Rework(flow, run, commit, 1).Error, reason)
                Check.That(
                    File.ReadAllText(Path.Combine(run, "verification.json")) == evidence,
                    "Unsafe Git layout reran repository verification"
                )
                Check.That(
                    File.ReadAllText(sentinel) == "synthetic-private-configuration" && !File.Exists(
                        sentinel + "-missing"
                    ),
                    "Unsafe layout touched private data"
                )
                flow.Reload()
                Check.That(Check.Text(flow.State["exec_count"]) == "1", "Unsafe layout spent extra inference")
                flow.NoPr()
            }
            Console.WriteLine("PASS CLI recovery rejects linked checkout/Git metadata and shared Git storage")
        }

        private func Records(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Call([]string{"work", "--yes", "--run", run})
            let path = Path.Combine(run, "run.json")
            let saved = Check.Json(File.ReadAllText(path))
            let results = saved["verification"]?.AsArray() ?? throw Exception("Missing verification results")
            let check = results[0] ?? throw Exception("Missing verification result")
            let original = check.DeepClone()
            let expected = Check.Map(
                "command",
                check["command"]?.DeepClone(),
                "state",
                "completed",
                "output_file",
                Check.Text(check["output_file"]),
                "error_file",
                Check.Text(check["error_file"]),
                "exit_code",
                0,
                "output",
                Check.Text(check["output"]),
                "error",
                Check.Text(check["error"]),
                "output_truncated",
                false,
                "error_truncated",
                false
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "verification.json")) == "[" + expected.ToJsonString() + "]",
                "Verification result bytes changed"
            )

            check.AsObject().Remove("command")
            File.WriteAllText(path, saved.ToJsonString())
            let missing = flow.Call([]string{"status", "--run", run, "--json"}, 1)
            let missingResult = Check.Envelope(missing, "status", "error", "invalid_state")
            Check.Contains(Check.Text(missingResult["error"]?["message"]), "Verification result: field \"command\"")

            results[0] = original.DeepClone()
            let completed = results[0] ?? throw Exception("Missing completed verification")
            completed.AsObject().Remove("exit_code")
            File.WriteAllText(path, saved.ToJsonString())
            let incomplete = flow.Call([]string{"status", "--run", run, "--json"}, 1)
            let incompleteResult = Check.Envelope(incomplete, "status", "error", "invalid_state")
            Check.Contains(
                Check.Text(incompleteResult["error"]?["message"]),
                "Verification result: field \"exit_code\""
            )

            results[0] = original.DeepClone()
            File.WriteAllText(path, saved.ToJsonString())
            Check.Envelope(flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
            Console.WriteLine("PASS saved verification requires named command and completed exit code fields")
        }
    }
}
