package TokateTests

import System
import System.IO
import System.Text.Json.Nodes

internal class ProtectedPathChecks {
    shared {
        private func Managed(binary string) {
            using let flow = NativeFlow(binary)
            flow.Initialize()
            flow.ProtectedPolicy()
            flow.Approve()
            let run = flow.Claim()
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for mode in[]string{"protected_entrypoint", "workflow", "replacement"} {
                baseline.Restore()
                flow.Mode(mode)
                let path = mode == "protected_entrypoint" ? "scripts/verify.sh":
                mode == "workflow" ? ".github/workflows/verify.yml": ".github/tokate-pr.md"
                let result = flow.Call([]string{"work", "--yes", "--run", run, "--json"}, 1)
                let failure = Check.Envelope(result, "work", "error", "protected_path")
                Check.Contains(Check.Text(failure["error"]?["message"]), path)
                let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
                Check.That(Check.Text(saved["state"]) == "failed", "Protected edit did not fail the run")
                Check.That(
                    Check.Text(saved["failure_stage"]) == "candidate_validation" && Check.Text(
                        saved["failure_reason"]
                    ) == "protected_path",
                    "Protected edit lost its failure stage or code"
                )
                Check.Contains(Check.Text(saved["error"]), path)
                let status = Check.Envelope(flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
                Check.That(
                    Check.Text(status["data"]?["error"]?["code"]) == "protected_path",
                    "Status lost protected_path"
                )
                Check.Contains(Check.Text(status["data"]?["error"]?["message"]), path)
                flow.Reload()
                let prompt = Check.Text(flow.State["prompts"]?[0])
                for text in[]string{
                    "## Protected paths",
                    "Do not add, edit, delete or rename",
                    ".github/workflows/",
                    "Every path starting with .github/tokate",
                    "Root DECREE.md",
                    "scripts/verify.sh",
                    "scripts/checks/",
                    "A trailing slash protects the directory and all descendants"
                } {
                    Check.Contains(prompt, text)
                }
                Check.That(!File.Exists(Path.Combine(run, "verification.json")), "Protected edit reached verification")
                Check.That(Check.Text(flow.State["exec_count"]) == "1", "Protected edit retried inference")
                flow.NoPr()
            }
            Console.WriteLine("PASS managed protected paths reach the prompt and retain failure codes and paths")
        }

        internal func All(binary string) {
            Managed(binary)
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            let flow = test.Flow
            let paths = []string{" protected", "\uFEFFprotected", "scripts/quoted\" ", "scripts/checks/line\n\".sh"}
            let entries = JsonArray()
            for path in paths {
                PublishedContribution.Write(flow.Upstream, path, "original\n")
                entries.Add(JsonValue.Create(path.Contains('\n') ? "scripts/checks/": path) as JsonNode)
            }
            let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["protected_paths"] = entries
            File.WriteAllText(policyPath, policy.ToJsonString())
            flow.Commit("Raw protected Git names")
            flow.Approve()
            let claim = test.ClaimRequest()
            test.Coordinate(test.Event(claim))
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for path in paths {
                baseline.Restore()
                test.Candidate(claim)
                let checkout = Path.Combine(flow.Temp.Root, "donor-work")
                File.AppendAllText(Path.Combine(checkout, path), "changed\n")
                flow.Git("-C", checkout, "add", "-A")
                flow.DonorGit(checkout, "commit", "-m", "Protected edit")
                let head = flow.Git("-C", checkout, "rev-parse", "HEAD")
                flow.Git(
                    "-C",
                    checkout,
                    "push",
                    Path.Combine(flow.Bin, "fork"),
                    "HEAD:refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
                )
                let result = test.Coordinate(test.Event(test.PublishRequest(claim, head)), 1)
                Check.Contains(result.Error, "protected owner path")
                flow.NoInference()
                Check.That(test.State()["state"]?["contribution"] == nil, "Protected edit gained publication authority")
            }
            Console.WriteLine(
                "PASS coordinated publication rejects whitespace, BOM, quoted and newline protected Git names"
            )
        }
    }
}
