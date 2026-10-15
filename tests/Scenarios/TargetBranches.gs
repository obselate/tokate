package TokateTests

import System
import System.IO
import System.Text.Json.Nodes

internal class TargetBranches {
    shared {
        private func Target(flow NativeFixture, branch string) string {
            flow.Git("-C", flow.Upstream, "checkout", "-b", branch)
            File.WriteAllText(Path.Combine(flow.Upstream, ".github/tokate-pr.md"), "Untrusted target template")
            File.WriteAllText(Path.Combine(flow.Upstream, "target.txt"), "Selected target code\n")
            flow.Commit("Different target configuration")
            let base = flow.Git("-C", flow.Upstream, "rev-parse", "HEAD")
            flow.Git("-C", Path.Combine(flow.Bin, "fork"), "fetch", flow.Upstream, branch)
            flow.Git("-C", flow.Upstream, "checkout", "main")
            return base
        }

        private func Approve(flow NativeFixture, branch string) JsonNode {
            flow.Call([]string{"approve", "owner/project#1", "--base-branch", branch}, owner: true)
            let state = flow.Git("-C", flow.Upstream, "show", "tokate/contributions/1:state.json")
            return Check.Json(state)["approval"] ?? throw Exception("Missing approval")
        }

        private func Move(flow NativeFixture, branch string) string {
            if branch == "release/next" {
                flow.Git("-C", flow.Upstream, "checkout", "--orphan", "replacement-target")
                File.WriteAllText(Path.Combine(flow.Upstream, "target.txt"), "Later target code\n")
            } else {
                flow.Git("-C", flow.Upstream, "checkout", branch)
            }
            File.WriteAllText(Path.Combine(flow.Upstream, "moved.txt"), "Later target revision\n")
            flow.Commit("Advance selected target")
            let moved = flow.Git("-C", flow.Upstream, "rev-parse", "HEAD")
            flow.Git("-C", flow.Upstream, "checkout", "main")
            if branch == "release/next" {
                flow.Git("-C", flow.Upstream, "branch", "-f", branch, moved)
                flow.Git("-C", flow.Upstream, "branch", "-D", "replacement-target")
            }
            return moved
        }

        private func RunBase(run string, base string, branch string) {
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.That(
                Check.Text(saved["base"]) == base && Check.Text(saved["base_branch"]) == branch,
                "Run changed its claim base"
            )
        }

        private func Receipt(flow NativeFixture, branch string, base string) {
            flow.Reload()
            let pull = flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
            Check.That(Check.Text(pull["base"]?["ref"]) == branch, "Publication changed the target")
            Check.That(
                !Check.Text(pull["body"]).Contains("Untrusted target template"),
                "Target template weakened authority"
            )
            flow.Receipt("owner/project#10", owner: true)
            flow.State["checks"] = Check.Json("[{\"name\":\"verify\",\"bucket\":\"pass\"}]")
            flow.Save()
            let current = flow.Git("-C", flow.Upstream, "rev-parse", branch)
            let checked = Check.Json(flow.Call([]string{"checks", "owner/project#10", "--json"}, owner: true).Output)
            Check.That(
                Check.Text(checked["data"]?["target_merge_required"]) == "false" && Check.Text(
                    checked["data"]?["gates"]?["freshness"]?["status"]
                ) == "passed" &&
                    Check.Text(checked["data"]?["verified_target_revision"]) == base && Check.Text(
                    checked["data"]?["target_revision_after"]
                ) == current,
                "Advanced named target lost readiness or revision facts"
            )
            flow.Git("-C", flow.Upstream, "update-ref", "refs/heads/" + branch, base)
            flow.Call([]string{"checks", "owner/project#10"}, owner: true)
            flow.Reload()
            flow.State["check_change"] = JsonValue.Create("base")
            flow.Save()
            flow.Call([]string{"checks", "owner/project#10"}, 1, owner: true)
            flow.Reload()
            flow.State["check_change"] = JsonValue.Create("")
            let restored = flow.State["pulls"]?[0]?["base"] ?? throw Exception("Missing base")
            restored["ref"] = JsonValue.Create(branch)
            flow.Save()
            flow.Reload()
            let head = flow.State["pulls"]?[0]?["head"] ?? throw Exception("Missing head")
            let sha = Check.Text(head["sha"])
            head["sha"] = JsonValue.Create(String('a', 40))
            flow.Save()
            flow.Call([]string{"checks", "owner/project#10"}, 1, owner: true)
            head["sha"] = JsonValue.Create(sha)
            let target = flow.State["pulls"]?[0]?["base"] ?? throw Exception("Missing base")
            target["ref"] = JsonValue.Create("main")
            flow.Save()
            flow.Receipt("owner/project#10", false, true)
            target["ref"] = JsonValue.Create(branch)
            flow.Save()
            flow.Git("-C", flow.Upstream, "branch", "-D", branch)
            flow.Receipt("owner/project#10", false, true)
        }

        private func V2(binary string, branch string, external bool) {
            using let test = CoordinationFixture(binary)
            test.Initialize()
            let flow = test.Flow
            let base = Target(flow, branch)
            let approval = Approve(flow, branch)
            Check.That(
                Check.Text(approval["authority_branch"]) == "main" && Check.Text(approval["base"]) == base,
                "V2 target lost approval authority"
            )
            let claim = test.ClaimRequest()
            test.Coordinate(test.Event(claim))
            if !external {
                File.WriteAllText(
                    test.Tools,
                    "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
                )
            }
            Move(flow, branch)
            let run = test.Prepare(external ? "external": "tokate")
            RunBase(run, base, branch)
            if external {
                let checkout = Path.Combine(flow.Temp.Root, "donor-work")
                flow.Git("clone", flow.Upstream, checkout)
                flow.Git("-C", checkout, "checkout", "--detach", base)
                File.WriteAllText(Path.Combine(checkout, "result.txt"), "External contribution\n")
                flow.Git("-C", checkout, "add", ".")
                flow.DonorGit(checkout, "commit", "-m", "Result")
                let head = flow.Git("-C", checkout, "rev-parse", "HEAD")
                flow.Git(
                    "-C",
                    checkout,
                    "push",
                    Path.Combine(flow.Bin, "fork"),
                    "HEAD:refs/heads/tokate/v2-" + Check.Text(claim["uuid"])
                )
                flow.Call(
                    []string{
                        "external",
                        "--run",
                        run,
                        "--commit",
                        head,
                        "--summary",
                        PublishedContribution.Summary(
                            flow,
                            head,
                            "Add a result containing the external contribution text."
                        )
                    }
                )
                flow.NoInference()
            } else {
                flow.Call([]string{"work", "--run", run})
            }
            Check.That(!File.Exists(Path.Combine(run, "checkout/moved.txt")), "V2 changed its base after the claim")
            RunBase(run, base, branch)
            flow.Call([]string{"submit", "--run", run, "--json"}, 8)
            let request = Check.Json(File.ReadAllText(Path.Combine(run, "request.json")))
            test.Coordinate(test.Event(request))
            Receipt(flow, branch, base)
        }

        private func Freshness(binary string) {
            using let test = CoordinationFixture(binary)
            let flow = test.Flow
            test.Initialize()
            let branch = "release/freshness"
            let base = Target(flow, branch)
            flow.Call([]string{"approve", "owner/project#1", "--base-branch", "release/missing"}, 1, owner: true)
            flow.NoInference()
            Console.WriteLine("PASS V2 target freshness: missing")
            flow.Call([]string{"approve", "owner/project#1", "--base-branch", branch}, owner: true)
            test.Coordinate(test.Event(test.ClaimRequest()))
            let run = test.Prepare()
            let saved = File.ReadAllText(Path.Combine(run, "run.json"))
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for change in[]string{"deleted", "authority", "policy", "template"} {
                baseline.Restore()
                if change == "deleted" {
                    flow.Git("-C", flow.Upstream, "branch", "-D", branch)
                } else if change == "authority" {
                    flow.Reload()
                    flow.State["default_branch"] = JsonValue.Create(branch)
                    flow.Save()
                } else {
                    if change == "policy" {
                        let path = Path.Combine(flow.Upstream, ".github/tokate.json")
                        let policy = Check.Json(File.ReadAllText(path))
                        policy["max_seconds"] = JsonValue.Create(3599)
                        File.WriteAllText(path, policy.ToJsonString())
                    } else {
                        File.AppendAllText(
                            Path.Combine(flow.Upstream, ".github/tokate-pr.md"),
                            "\nChanged authority template\n"
                        )
                    }
                    flow.Commit("Owner configuration changed")
                }
                let result = flow.Call([]string{"external", "--run", run, "--commit", base}, 1)
                Check.Contains(
                    result.Error,
                    change == "deleted" ? "GitHub read failed (HTTP 404)": "The owner must run: tokate approve owner/project#1"
                )
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == saved,
                    "Failed freshness check rewrote saved run"
                )
                flow.NoInference()
                flow.NoPr()
                Console.WriteLine("PASS V2 target freshness: " + change)
            }
        }

        private func Instructions(binary string) {
            using let test = DecreeFlow.Create(binary, 2)
            let flow = test.Flow
            let branch = "release/instructions"
            test.Text("Authority instructions\n")
            flow.Git("-C", flow.Upstream, "checkout", "-b", branch)
            test.Text(DecreeFlow.Exact)
            flow.Git("-C", flow.Upstream, "checkout", "main")
            Approve(flow, branch)
            test.Snapshot(DecreeFlow.Exact, true)
            let run = test.Start()
            let saved = File.ReadAllText(Path.Combine(run, "run.json"))
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            flow.Git("-C", flow.Upstream, "checkout", branch)
            test.Text("Changed selected instructions\n")
            flow.Git("-C", flow.Upstream, "checkout", "main")
            flow.Call([]string{"work", "--run", run}, 1)
            Check.That(
                File.ReadAllText(Path.Combine(run, "run.json")) == saved,
                "Changed instructions rewrote saved work"
            )
            flow.NoInference()
            flow.NoPr()
            Console.WriteLine("PASS V2 target instruction boundary: changed")
            baseline.Restore()
            let path = Path.Combine(flow.Upstream, "DECREE.md")
            File.Delete(path)
            File.CreateSymbolicLink(path, "target.txt")
            flow.Commit("Unsupported authority instructions are outside selected target")
            Move(flow, branch)
            flow.Call([]string{"work", "--run", run})
            test.Prompt(DecreeFlow.Exact, true)
            flow.NoPr()
            Console.WriteLine("PASS V2 target instruction boundary: authority and unrelated target changes")
        }

        private func Structured(binary string) {
            for version in[]int32{2} {
                using let test = DecreeFlow(binary, version)
                test.Initialize()
                let flow = test.Flow
                test.Text("synthetic-private-owner-instruction-marker\n")
                let base = Target(flow, "release")
                flow.Call([]string{"approve", "owner/project#1", "--base-branch", "release", "--json"}, owner: true)
                let result = flow.Call([]string{"status", "owner/project#1", "--json"})
                let approval = Check.Envelope(result, "status", "ok")["data"]?["coordination"]?["approval"]
                Check.That(
                    Check.Text(approval?["base_branch"]) == "release" && Check.Text(approval?["base"]) == base &&
                        Check.Text(approval?["authority_branch"]) == "main",
                    "JSON merged target and authority"
                )
                Check.That(
                    Check.Text(approval?["decree"]?["present"]) == "true" && Check.Text(
                        approval?["decree"]?["sha256"]
                    ) == "e98121ab8e2b22651b3213509dd86d823df9a110c68bda77a95754b848e6b584",
                    "JSON lost instruction presence/hash"
                )
                Check.That(
                    !result.Output.Contains("synthetic-private-owner-instruction-marker") &&
                        approval?["decree"]?["text"] == nil,
                    "Generic JSON exposed instruction text"
                )
                flow.Temp.Env["GH_TOKEN"] = "fixture-owner"
                File.WriteAllText(Path.Combine(flow.Temp.Env["GH_CONFIG_DIR"], "identity"), "owner")
                for command in[]string{"approve"} {
                    let shell = "stty -echo; '" +
                        binary +
                        "' " +
                        command +
                        " owner/project#1 --json 2> '" +
                        Path.Combine(flow.Temp.Root, "diagnostics") + "'"
                    let result = TestProcess.Run(
                        "/usr/bin/script",
                        []string{"-q", "-e", "-c", shell, "/dev/null"},
                        flow.Temp.Env,
                        ""
                    )
                    Check.Envelope(result, command, "ok")
                    Check.That(!result.Output.Contains("Target branch"), "JSON terminal approval prompted")
                    Check.That(Check.Text(test.Approval()["base_branch"]) == "main", "JSON default target changed")
                    let metadata = Check.Envelope(flow.Call([]string{"help", command, "--json"}), "help", "ok")
                    Check.That(
                        metadata["data"]?["commands"]?[0]?["arguments"]?.ToJsonString().Contains("base-branch") == true,
                        "JSON metadata lost target option"
                    )
                }
                flow.NoInference()
            }
            using let policyFlow = NativeFixture(binary)
            policyFlow.Initialize()
            let path = Path.Combine(policyFlow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            policy["protected_paths"] = Check.Json("[\"scripts/check.sh\",\" literal name\"]")
            for mode in[]string{"whitelist", "unrestricted"} {
                if mode == "unrestricted" {
                    Check.SetModels(policy, nil)
                }
                File.WriteAllText(path, policy.ToJsonString())
                policyFlow.Commit("Projected owner model and path policy")
                let projected = Check.Envelope(
                    policyFlow.Call([]string{"doctor", "repo", "owner/project", "--json"}),
                    "doctor",
                    "ok"
                )
                Check.That(
                    (projected["data"]?["policy"]?["allowed_tools"]?[0]?["models"] == nil) == (mode == "unrestricted"),
                    "JSON lost effective model mode"
                )
                Check.That(
                    JsonNode.DeepEquals(projected["data"]?["policy"]?["protected_paths"], policy["protected_paths"]) &&
                        Check.Text(projected["data"]?["policy"]?["protected_paths_count"]) == "2" && Check.Text(
                        projected["truncated"]
                    ) == "false",
                    "JSON lost protected path values/count"
                )
            }
            policyFlow.NoInference()
            Console.WriteLine(
                "PASS target JSON authority, instruction summaries, model/path policies and terminal approval without prompts"
            )
        }

        internal func All(binary string, selected string = "") {
            if selected != "" && selected != "Receipts" {
                Check.That(selected == "Structured", "Unknown target test group")
                Structured(binary)
                return
            }
            if selected != "Receipts" {
                Structured(binary)
            }
            V2(binary, "release", false)
            V2(binary, "release/next", true)
            Console.WriteLine("PASS V2 managed and external selected targets")
            if selected == "Receipts" {
                return
            }
            Freshness(binary)
            Instructions(binary)
        }
    }
}
