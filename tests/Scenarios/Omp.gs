package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Text.Json.Nodes

internal class OmpChecks {
    shared {
        private func Managed(binary string) {
            for mode in[]string{"normal", "failed", "substituted", "length", "incomplete"} {
                using let test = CoordinationFixture(binary)
                test.Initialize(approve: false)
                let flow = test.Flow
                flow.Temp.Tool("omp")
                let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
                let policy = Check.Json(File.ReadAllText(policyPath))
                policy["allowed_tools"] = Check.Json("[{\"harness\":\"omp\",\"provider\":\"openrouter\"}]")
                policy["models"] = Check.Json("{\"" + OmpTool.Model + "\":[\"low\"]}")
                Check.SaveJson(policyPath, policy)
                flow.Commit("OMP managed fixture")
                flow.Approve()
                let settings = Path.Combine(flow.Temp.Env["HOME"], ".omp")
                Directory.CreateDirectory(settings)
                File.WriteAllText(Path.Combine(settings, "mode"), mode)
                File.Delete(Path.Combine(flow.Bin, "codex"))
                File.Delete(Path.Combine(flow.Bin, "codex-impl"))
                if mode == "normal" {
                    flow.Temp.Env["TERM"] = "dumb"
                    flow.Temp.Env["NO_COLOR"] = "1"
                    let cancelled = TestTerminal.Pty(
                        binary,
                        []string{
                            "work",
                            "owner/project",
                            "--issue",
                            "1",
                            "--seconds",
                            "60",
                            "--verification-reserve",
                            "20"
                        },
                        flow.Temp,
                        100,
                        "1\n1\nq\n"
                    )
                    Check.That(cancelled.Code == 1, cancelled.Output + cancelled.Error)
                    Check.Contains(cancelled.Output, "OMP | Your OMP providers")
                    Check.Contains(cancelled.Output, "openrouter | OMP | " + OmpTool.Model + " / low")
                    Check.Contains(cancelled.Output.Replace("\r\n", " "), "Review donation")
                    Check.That(
                        !cancelled.Output.Contains("Uses your selected harness subscription"),
                        "OMP wizard claimed subscription billing"
                    )
                    Check.That(!cancelled.Output.Contains("/ high"), "Wizard offered an effort the policy forbids")
                    flow.Call(
                        []string{
                            "defaults",
                            "set",
                            "--profile",
                            "omp",
                            "--harness",
                            "omp",
                            "--provider",
                            "openrouter",
                            "--model",
                            OmpTool.Model,
                            "--effort",
                            "low"
                        }
                    )
                }
                Check.That(!File.Exists(Path.Combine(settings, "ran")), "OMP inference started before the claim")
                flow.NoPr()
                let selection = mode == "normal" ? []string{"--profile", "omp"}:
                []string{"--harness", "omp", "--model", OmpTool.Model, "--effort", "low"}
                let claim = List[string]{"claim", "--repo", "owner/project", "--issue", "1"}
                claim.AddRange(selection)
                claim.AddRange(
                    []string{
                        "--seconds",
                        "60",
                        "--verification-reserve",
                        "20",
                        "--runs",
                        Path.Combine(flow.Temp.Root, "runs")
                    }
                )
                let prepared = flow.Acquire(claim.ToArray())
                let index = prepared.Output.LastIndexOf("Run: ")
                Check.That(index >= 0, "OMP claim did not return a run")
                let run = prepared.Output.Substring(index + 5).Trim()
                Check.That(!File.Exists(Path.Combine(settings, "ran")), "Claiming started OMP inference")
                let worked = flow.Call(
                    []string{"work", "--run", run, "--yes", "--non-interactive"},
                    mode == "normal" ? 0: 1
                )
                if mode == "failed" {
                    Check.Contains(
                        worked.Error,
                        "OMP did not complete: 402 Insufficient credits for this request [redacted];"
                    )
                }
                let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
                Check.That(Check.Text(saved["omp_version"]) == "100.0.0", "OMP version was not recorded")
                Check.That(
                    Check.Text(saved["state"]) == (mode == "normal" ? "generated": "failed"),
                    "OMP completion state is wrong"
                )
                Check.That(
                    Check.Text(saved["provider"]) == "openrouter" && Check.Text(
                        saved["observed_invocation"]?["model"]
                    ) == OmpTool.Model,
                    "OMP invocation lost its exact provider or model"
                )
                Check.That(
                    Check.Text(saved["selection"]?["context_window"]) == "200000" && Check.Text(
                        saved["selection"]?["max_tokens"]
                    ) == "16000",
                    "OMP-reported model limits were not recorded"
                )
                if mode == "normal" {
                    Check.That(
                        Check.Text(saved["verification"]?[0]?["exit_code"]) == "0",
                        "OMP skipped independent verification"
                    )
                    Check.That(
                        Check.Text(saved["usage"]?["input_tokens"]) == "100" && Check.Text(
                            saved["usage"]?["cached_input_tokens"]
                        ) == "20" &&
                            Check.Text(saved["usage"]?["output_tokens"]) == "7",
                        "OMP usage was not mapped"
                    )
                    let status = Check.Envelope(flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
                    Check.That(Check.Text(status["data"]?["omp_version"]) == "100.0.0", "OMP status lost its version")
                    flow.Publish(run)
                    Check.Contains(flow.Body(), "omp")
                    Check.Contains(flow.Body(), OmpTool.Model)
                } else {
                    Check.That(saved["turn_completed"] == nil && saved["commit"] == nil, "Failed OMP turn was accepted")
                    Check.Contains(
                        Check.Text(saved["error"]),
                        mode == "failed" ? "OMP did not complete: 402 Insufficient credits for this request [redacted];":
                        mode == "substituted" ? "differs from the selected model or provider":
                        mode == "length" ? "output length limit": "did not report a terminal result"
                    )
                    flow.NoPr()
                }
                flow.Call([]string{"work", "--run", run, "--yes", "--non-interactive"}, 1)
            }
            Console.WriteLine("PASS OMP managed wizard, profile, claim, work, verification, publication and refusals")
        }

        private func Pick(extra[]string)[]string {
            let words = List[string]{"select", "--repo", "owner/project", "--harness", "omp", "--json"}
            words.AddRange(extra)
            return words.ToArray()
        }

        private func Refused(flow NativeFixture, extra[]string, reason string) {
            let words = List[string]{"select", "--repo", "owner/project", "--harness", "omp"}
            words.AddRange(extra)
            Check.Contains(flow.Call(words.ToArray(), 1).Error, reason)
        }

        private func Selection(binary string) {
            using let test = CoordinationFixture(binary)
            test.Initialize(approve: false)
            let flow = test.Flow
            flow.Temp.Tool("omp")
            let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["allowed_tools"] = Check.Json(
                "[{\"harness\":\"omp\",\"provider\":\"openrouter\"},{\"harness\":\"omp\",\"provider\":\"llama.cpp\"}]"
            )
            policy["models"] = Check.Json("{\"" + OmpTool.Model + "\":[\"low\",\"medium\"],\"plain\":[\"absent\"]}")
            policy["model_policy"] = JsonValue.Create("whitelist")
            Check.SaveJson(policyPath, policy)
            flow.Commit("OMP selection fixture")
            let settings = Path.Combine(flow.Temp.Env["HOME"], ".omp")
            Directory.CreateDirectory(settings)
            let chosen = Check.Envelope(
                flow.Call(Pick([]string{"--provider", "openrouter", "--model", OmpTool.Model, "--effort", "low"})),
                "select",
                "ok"
            )
            Check.That(
                Check.Text(chosen["data"]?["harness"]) == "omp" && Check.Text(
                    chosen["data"]?["provider"]
                ) == "openrouter",
                "OMP selection lost its harness or provider"
            )
            let plain = Check.Envelope(
                flow.Call(Pick([]string{"--provider", "llama.cpp", "--model", "plain", "--effort", "absent"})),
                "select",
                "ok"
            )
            Check.That(Check.Text(plain["data"]?["effort"]) == "absent", "Non-reasoning OMP model was refused")
            Refused(flow, []string{"--model", OmpTool.Model, "--effort", "low"}, "Choose --provider for OMP")
            Refused(
                flow,
                []string{"--provider", "openrouter", "--model", OmpTool.Model, "--effort", "medium"},
                "OMP does not support the selected reasoning effort"
            )
            Refused(
                flow,
                []string{"--provider", "openrouter", "--model", OmpTool.Model, "--effort", "high"},
                "exact omp/openrouter permission"
            )
            Refused(
                flow,
                []string{"--provider", "openrouter", "--model", "plain", "--effort", "absent"},
                "OMP does not list exactly one openrouter/plain"
            )
            Refused(
                flow,
                []string{"--provider", "gufo", "--model", OmpTool.Model, "--effort", "low"},
                "omp/gufo is rejected by current exact owner tool restrictions"
            )
            flow.Call([]string{"defaults", "set", "--harness", "omp"})
            Refused(flow, []string{"--model", "plain", "--effort", "absent"}, "Choose --provider for OMP")
            Check.Contains(
                Check
                    .Envelope(flow.Call([]string{"doctor", "--managed", "--json"}), "doctor", "ok")["data"]?["tools"]
                    ?.ToJsonString() ?? "",
                "OMP 100.0.0; 2 configured models"
            )
            let ready = Check.Envelope(
                flow.Call([]string{"doctor", "--managed", "--harness", "omp", "--json"}),
                "doctor",
                "ok"
            )
            Check.Contains(ready["data"]?["tools"]?.ToJsonString() ?? "", "OMP 100.0.0; 2 configured models")
            File.WriteAllText(Path.Combine(settings, "mode"), "empty")
            let empty = flow.Call([]string{"doctor", "--managed", "--harness", "omp", "--json"}, 1)
            Check.Contains(empty.Output, "OMP lists no models")
            File.Delete(Path.Combine(flow.Bin, "omp"))
            let missing = flow.Call([]string{"doctor", "--managed", "--harness", "omp", "--json"}, 1)
            Check.Contains(missing.Output, "OMP was not found")
            Check.That(!File.Exists(Path.Combine(settings, "ran")), "Selection or diagnostics started OMP inference")
            Console.WriteLine("PASS OMP provider, model and effort selection with no-inference diagnostics")
        }

        internal func Proof(binary string, omp string, directory string, endpoint string, mode string) {
            let test = CoordinationFixture(binary)
            using let cleanup = mode == "cancel" || mode == "timeout" ? nil: test
            test.Initialize(approve: false)
            let flow = test.Flow
            let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["allowed_tools"] = Check.Json("[{\"harness\":\"omp\",\"provider\":\"tokate-proof\"}]")
            policy["model_policy"] = JsonValue.Create("whitelist")
            policy["models"] = Check.Json("{\"synthetic/model:exact\":[\"absent\"]}")
            policy["verification"] = Check.Json("[[\"/bin/sh\",\"-c\",\"test \\\"$$(cat result.txt)\\\" = final\"]]")
            Check.SaveJson(policyPath, policy)
            flow.Commit("OMP proof policy")
            flow.Approve()
            let settings = Path.Combine(flow.Temp.Env["HOME"], ".omp/agent")
            Directory.CreateDirectory(Path.Combine(settings, "extensions"))
            File.WriteAllText(
                Path.Combine(settings, "models.yml"),
                "providers:\n  tokate-proof:\n    baseUrl: " +
                    endpoint +
                    "\n    api: openai-completions\n    auth: none\n    models:\n      - id: \"synthetic/model:exact\"\n        name: Synthetic\n        reasoning: false\n        input: [text]\n        contextWindow: 65536\n        maxTokens: 8192\n        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}\n"
            )
            let loaded = Path.Combine(flow.Temp.Root, "extension-loaded")
            File.WriteAllText(
                Path.Combine(settings, "extensions/fixture.ts"),
                "import { writeFileSync } from \"node:fs\";\nexport default function (pi) {\n  writeFileSync(" +
                    Check
                    .Map("path", loaded)["path"]
                    ?.ToJsonString() +
                    ", \"loaded\");\n  pi.registerTool({ name: \"fixture_tool\", label: \"Fixture\", description: \"Check the configured extension.\", parameters: pi.zod.object({}), async execute() { return { content: [{ type: \"text\", text: \"configured extension worked\" }], details: {} }; } });\n}\n"
            )
            File.CreateSymbolicLink(Path.Combine(flow.Bin, "omp"), omp)
            File.Delete(Path.Combine(flow.Bin, "codex"))
            File.Delete(Path.Combine(flow.Bin, "codex-impl"))
            let ready = Check.Envelope(
                flow.Call([]string{"doctor", "--managed", "--harness", "omp", "--json"}),
                "doctor",
                "ok"
            )
            Check.Contains(ready["data"]?["tools"]?.ToJsonString() ?? "", "configured models listed")
            let prepared = flow.Acquire(
                []string{
                    "claim",
                    "--repo",
                    "owner/project",
                    "--issue",
                    "1",
                    "--harness",
                    "omp",
                    "--model",
                    "synthetic/model:exact",
                    "--effort",
                    "absent",
                    "--seconds",
                    mode == "timeout" ? "45": "120",
                    "--verification-reserve",
                    "30",
                    "--runs",
                    Path.Combine(flow.Temp.Root, "runs")
                }
            )
            let index = prepared.Output.LastIndexOf("Run: ")
            Check.That(index >= 0, "OMP claim did not return a run")
            let run = prepared.Output.Substring(index + 5).Trim()
            let checkout = Path.Combine(run, "checkout")
            let git = File.ReadAllText(Path.Combine(checkout, ".git/config"))
            File.WriteAllText(
                Path.Combine(directory, "fixture.json"),
                Check.Map("checkout", checkout, "run", run).ToJsonString()
            )
            let success = mode == "stop" || mode == "tools"
            flow.Call([]string{"work", "--run", run, "--non-interactive", "--yes"}, success ? 0: 1)
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            File.Copy(Path.Combine(run, "run.json"), Path.Combine(directory, "result.json"), true)
            Check.That(File.Exists(loaded), "Managed OMP ignored the donor's configured extension")
            Check.That(
                File.ReadAllText(Path.Combine(checkout, ".git/config")) == git,
                "OMP run changed checkout Git configuration"
            )
            Check.That(
                Check.Text(saved["omp_version"]) != "" && Check.Text(
                    saved["observed_invocation"]?["provider"]
                ) == "tokate-proof" &&
                    Check.Text(saved["observed_invocation"]?["max_tokens"]) == "8192",
                "OMP launch evidence is incomplete"
            )
            Check.That(
                Check.Text(saved["state"]) == (success ? "generated": "failed"),
                "OMP completion state is wrong: " + Check.Text(saved["error"])
            )
            if success {
                Check.That(
                    Check.Text(saved["verification"]?[0]?["exit_code"]) == "0",
                    "OMP skipped independent verification"
                )
                flow.Publish(run)
                Check.Contains(flow.Body(), "synthetic/model:exact")
            } else {
                Check.That(saved["turn_completed"] == nil && saved["commit"] == nil, "Failed OMP turn was accepted")
                Check.That(
                    Check.Text(saved["failure_reason"]) == (
                        mode == "failed" ? "inference_failed": "inference_interrupted"
                    ),
                    "OMP failure reason is wrong: " + Check.Text(saved["failure_reason"])
                )
                if mode == "failed" {
                    Check.Contains(Check.Text(saved["error"]), "Insufficient credits")
                }
                flow.NoPr()
            }
            Console.WriteLine("PASS native OMP workflow " + mode)
        }

        internal func All(binary string) {
            Managed(binary)
            Selection(binary)
        }
    }
}
