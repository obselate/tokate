package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Text.Json.Nodes

internal class DonorSelectionChecks {
    shared {
        private func Set(
            flow NativeFixture,
            model string = "gpt-6.1-sol",
            effort string = "high",
            harness string = "codex",
            provider string = "openai",
            profile string = ""
        ) {
            let args = List[string]{
                "defaults",
                "set",
                "--harness",
                harness,
                "--provider",
                provider,
                "--model",
                model,
                "--effort",
                effort
            }
            if profile != "" {
                args.Add(profile)
            }
            flow.Call(args.ToArray())
        }

        private func Select(flow NativeFixture, extra[]string, code int32 = 0) JsonNode {
            let args = List[string]{"defaults", "check", "owner/project"}
            args.AddRange(extra)
            let result = flow.Call(args.ToArray(), code)
            flow.NoInference()
            if code != 0 {
                Check.Contains(result.Error, "No inference started")
                return Check.Map("error", result.Error)
            }
            return Check.Json(result.Output)
        }

        private func Settings(flow NativeFixture) string -> Path.Combine(
            flow.Temp.Env["HOME"],
            ".local/state/tokate/donor-defaults.json"
        )

        private func ExpandPolicy(flow NativeFixture, alternative bool = false) {
            let path = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            Check.SetModels(
                policy,
                Check.Json(
                    alternative ?
                    "{\"gpt-6.1-sol\":[\"high\",\"xhigh\",\"minimal\"],\"gpt-6-sol\":[\"high\"]}":
                    "{\"gpt-6.1-sol\":[\"high\",\"xhigh\",\"minimal\"]}"
                )
            )
            File.WriteAllText(path, policy.ToJsonString())
            flow.Commit("Selection fixture policy")
            flow.Git("-C", Path.Combine(flow.Bin, "fork"), "fetch", flow.Upstream, "main")
        }

        private func LocalSettings(binary string) {
            using let flow = NativeFixture(binary)
            flow.Temp.Env["PATH"] = "/empty"
            let read = flow.Call([]string{"defaults", "show"})
            Check.That(Check.Json(read.Output)["default"] == nil, "Missing defaults were fabricated")
            Set(flow)
            let path = Settings(flow)
            let value = Check.Json(File.ReadAllText(path)).AsObject()
            Check.That(value.Count == 4, "Settings contain imported data")
            Check.That(
                File.GetUnixFileMode(path) == (UnixFileMode.UserRead | UnixFileMode.UserWrite),
                "Settings permissions are not private"
            )
            Check.That(read.Error == "", "Defaults require harness prerequisites")
            Check.Contains(flow.Call([]string{"defaults", "show"}).Output, "gpt-6.1-sol")
            flow.Call([]string{"defaults", "remove"})
            Check.That(!File.Exists(path), "Defaults were not removed")
            for flag in[]string{"--plain", "--ascii"} {
                Check.Contains(
                    flow.Call([]string{"defaults", flag}).Output,
                    "Default: none. Choose one with tokate defaults use NAME.\n"
                )
            }
            let named = Path.Combine(flow.Temp.Env["HOME"], ".local/state/tokate/donor-profiles/local.json")
            let privateRoot = Path.Combine(flow.Temp.Root, "private-runtime", "node_modules")
            let privateNode = Path.Combine(flow.Temp.Root, "private-runtime", "node")
            let pi = flow.Call(
                []string{
                    "defaults",
                    "set",
                    "local",
                    "--harness",
                    "pi",
                    "--provider",
                    "local-chat-completions",
                    "--model",
                    "synthetic/model:exact",
                    "--effort",
                    "absent",
                    "--endpoint",
                    "http://127.0.0.1:12345/v1",
                    "--pi-root",
                    privateRoot,
                    "--node",
                    privateNode
                }
            )
            let stored = Check.Json(File.ReadAllText(named)).AsObject()
            Check.That(
                stored.Count == 7 && Check.Text(stored["pi-root"]) == privateRoot && Check.Text(
                    stored["node"]
                ) == privateNode,
                "Pi profile dropped explicit private overrides"
            )
            Check.That(
                File.GetUnixFileMode(named) == (UnixFileMode.UserRead | UnixFileMode.UserWrite) && File.GetUnixFileMode(
                    Path.GetDirectoryName(named) ?? ""
                ) ==
                (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute),
                "Named profile permissions are not private"
            )
            Check.Contains(
                flow.Call([]string{"defaults", "list", "--plain"}).Output,
                "Profiles:\n  local:\n    Harness: pi\n"
            )
            for output in[]string{
                pi.Output,
                flow.Call([]string{"defaults", "show", "local"}).Output,
                flow.Call([]string{"defaults", "list"}).Output
            } {
                Check.Contains(output, "synthetic/model:exact")
                Check.That(
                    !output.Contains("127.0.0.1") && !output.Contains(privateRoot) && !output.Contains(privateNode),
                    "Public profile output exposed private settings"
                )
            }
            for invalid in[]string{"../escape", ".", "x/y", "bad name"} {
                flow.Call([]string{"defaults", "show", invalid}, 1)
            }
            flow.Call([]string{"defaults", "show", "missing"}, 1)
            let original = File.ReadAllText(named)
            for invalid in[]string{
                "{\"harness\":\"pi\",\"credentials\":\"synthetic-private-account-data\"}",
                "{\"harness\":\"pi\",\"harness\":\"codex\"}",
                String('x', 16385)
            } {
                File.WriteAllText(named, invalid)
                flow.Call([]string{"defaults", "show", "local"}, 1)
            }
            File.WriteAllText(named, original)
            flow.Call([]string{"defaults", "remove", "local"})
            Check.That(!File.Exists(named), "Named profile was not removed")
            flow.Call([]string{"defaults", "set", "codex-only", "--harness", "codex"})
            flow.Call(
                []string{"defaults", "set", "pi-only", "--harness", "pi", "--endpoint", "http://127.0.0.1:12345/v1"}
            )
            flow.Call([]string{"defaults", "set", "pi-only", "--model", "local/model", "--effort", "absent"})
            Check.That(
                Check.Text(
                    Check.Json(flow.Call([]string{"defaults", "show", "pi-only"}).Output)["default"]?["harness"]
                ) == "pi",
                "Adding model settings changed the profile harness"
            )
            flow.Call([]string{"defaults", "use", "codex-only"})
            Check.That(
                Check.Text(
                    Check.Json(flow.Call([]string{"defaults", "show"}).Output)["default"]?["harness"]
                ) == "codex",
                "Named Codex profile was not selected"
            )
            flow.Call([]string{"defaults", "use", "pi-only"})
            Check.That(
                Check.Text(Check.Json(flow.Call([]string{"defaults", "show"}).Output)["default"]?["harness"]) == "pi",
                "Named Pi profile was not selected"
            )
            Check.That(
                Check.Text(
                    Check.Json(flow.Call([]string{"defaults", "show", "codex-only"}).Output)["default"]?["harness"]
                ) == "codex",
                "Changing defaults overwrote another profile"
            )
            flow.Call([]string{"defaults", "use", "missing"}, 1)
            flow.Call([]string{"defaults", "set", "--harness", "omp"})
            Check.That(
                Check.Text(Check.Json(flow.Call([]string{"defaults", "show"}).Output)["default"]?["provider"]) == "",
                "External harness default invented managed support"
            )
            flow.Call([]string{"defaults", "set", "--harness", "unknown"}, 1)
            flow.Call([]string{"defaults", "set", "--harness", "pi", "--provider", "openai"}, 1)
            flow.Call([]string{"defaults", "remove"})
            let privateFile = Path.Combine(flow.Temp.Root, "private-config")
            File.WriteAllText(privateFile, "synthetic-private-account-data")
            File.CreateSymbolicLink(path, privateFile)
            let refused = flow.Call([]string{"defaults", "show"}, 1)
            Check.Contains(refused.Error, "symbolic links")
            Check.That(!refused.Error.Contains("synthetic-private-account-data"), "Settings exposed a linked file")
            flow.Reload()
            Check.That(
                flow.State["discovery_count"] == nil && flow.State["api_calls"] == nil,
                "Local settings invoked discovery"
            )
        }

        private func Choices(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            ExpandPolicy(flow, true)
            Select(flow, []string{}, 1)
            Set(flow)
            let original = File.ReadAllText(Settings(flow))
            let chosen = Select(flow, []string{})
            Check.That(Check.Text(chosen["source"]) == "saved donor default", "Eligible default did not win")
            Check.That(Check.Text(chosen["availability"]) == "unknown", "Catalog presence proved availability")
            flow.Call([]string{"defaults", "set", "--harness", "codex"})
            Check.That(
                File.ReadAllText(Settings(flow)) == original,
                "Selecting the same harness erased its model settings"
            )
            let overridden = Select(
                flow,
                []string{"--model", "gpt-6.1-sol", "--effort", "xhigh", "--availability", "available"}
            )
            Check.That(Check.Text(overridden["effort"]) == "xhigh", "Explicit choice did not override saved choice")
            Check.That(
                Check.Text(overridden["availability"]) == "donor-reported available",
                "Availability provenance was lost"
            )
            Check.That(File.ReadAllText(Settings(flow)) == original, "Selection changed preferences")
            let partial = Select(flow, []string{"--effort", "xhigh"})
            Check.That(Check.Text(partial["effort"]) == "xhigh", "Explicit effort override was ignored")
            Select(flow, []string{"--availability", "unavailable"}, 1)
            Set(flow, model: "rejected")
            Select(flow, []string{}, 1)
            Set(flow, effort: "minimal")
            Select(flow, []string{}, 1)
            Select(flow, []string{"--model", "gpt-6.1-sol", "--effort", "minimal"}, 1)
            Set(flow, harness: "claude", provider: "anthropic")
            Select(flow, []string{}, 1)
            let explicitChoice = Select(
                flow,
                []string{"--harness", "codex", "--model", "gpt-6.1-sol", "--effort", "high"}
            )
            Check.That(Check.Text(explicitChoice["harness"]) == "codex", "Explicit harness override was ignored")
            flow.Call(
                []string{
                    "defaults",
                    "check",
                    "owner/project",
                    "--harness",
                    "claude",
                    "--model",
                    "gpt-6.1-sol",
                    "--effort",
                    "high"
                },
                1
            )
            File.WriteAllText(Settings(flow), "{\"credentials\":\"synthetic-private-secret\"}")
            let invalid = Select(flow, []string{}, 1)
            Check.That(!invalid.ToJsonString().Contains("synthetic-private-secret"), "Invalid settings leaked contents")
            Select(flow, []string{"--model", "gpt-6.1-sol", "--effort", "high"})
            flow.Reload()
            Check.That(flow.State["login_count"] == nil, "Selection inspected private login state")
            flow.Mode("missing_controls")
            Check.Contains(
                flow.Call(
                    []string{"defaults", "check", "owner/project", "--model", "gpt-6.1-sol", "--effort", "high"},
                    1
                )
                    .Error,
                "required explicit controls"
            )
            flow.NoInference()
            flow.Mode("")
            let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            Check.SetModels(policy, Check.Json("{\"gpt-6.1-sol\":[\"minimal\"]}"))
            File.WriteAllText(policyPath, policy.ToJsonString())
            flow.Commit("No compatible effort")
            Select(flow, []string{}, 1)
            flow.NoPr()
        }

        private func ConfirmationAndRuns(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let custom = Path.Combine(flow.Temp.Root, "custom-codex")
            File.Move(Path.Combine(flow.Bin, "codex"), custom)
            flow.Call(
                []string{"defaults", "set", "--model", "gpt-6.1-sol", "--effort", "high", "--harness-path", custom}
            )
            let defaults = File.ReadAllText(Settings(flow))
            Check.Contains(defaults, custom)
            Check.That(
                !flow.Call([]string{"defaults", "show"}).Output.Contains(custom),
                "Public defaults exposed harness path"
            )
            let invalid = flow.Call(
                []string{"defaults", "check", "owner/project", "--harness-path", custom + "-missing", "--json"},
                1
            )
            Check.Envelope(invalid, "defaults", "error", "missing_tools")
            Check.That(File.ReadAllText(Settings(flow)) == defaults, "Invalid override changed saved defaults")
            let claimed = flow.Acquire(
                []string{"claim", "owner/project#1", "--time", "30s", "--runs", Path.Combine(flow.Temp.Root, "runs")}
            )
            let run = claimed.Output.Substring(claimed.Output.LastIndexOf("Run: ") + 5).Trim()
            let path = Path.Combine(run, "run.json")
            let original = File.ReadAllText(path)
            Check.That(Check.Text(Check.Json(original)["harness_path"]) == custom, "Claim lost its custom harness path")
            let unselected = Check.Json(original)
            unselected.AsObject().Remove("selection")
            unselected.AsObject().Remove("harness")
            unselected.AsObject().Remove("provider")
            File.WriteAllText(path, unselected.ToJsonString())
            let stripped = File.ReadAllText(path)
            Check.Contains(flow.Call([]string{"work", "--run", run}, 1).Error, "require saved selection metadata")
            Check.That(File.ReadAllText(path) == stripped, "Invalid selection changed saved work")
            flow.NoInference()
            File.WriteAllText(path, original)
            Set(flow, effort: "xhigh")
            flow.Mode("capability_changed")
            Check.Contains(flow.Call([]string{"work", "--run", run}, 1).Error, "no longer compatible")
            flow.NoInference()
            Check.That(File.ReadAllText(path) == original, "Capability rejection changed saved work")
            flow.Mode("model_failure")
            flow.Call([]string{"work", "--run", run}, 1)
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Model failure retried or fell back")
            Check.That(
                Check.Text(Check.Json(File.ReadAllText(path))["state"]) == "failed",
                "Model failure did not stop"
            )
            let requested = flow.State["exec_args"]?.ToJsonString() ?? ""
            Check.Contains(requested, "high")
            Check.That(!requested.Contains("xhigh"), "Preferences substituted the saved effort")
            flow.Call([]string{"work", "--run", run}, 1)
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Failed run spent inference again")
            flow.NoPr()
        }

        private func InteractiveChoices(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            ExpandPolicy(flow)
            let refused = TestTerminal.Pty(
                binary,
                []string{"defaults", "check", "owner/project", "--plain"},
                flow.Temp,
                80,
                "1\n"
            )
            Check.That(refused.Code == 1, "Terminal input supplied a missing model choice")
            Check.Contains(refused.Output, "--model")
            Check.Contains(refused.Output, "--effort")
            flow.NoInference()
            flow.NoPr()
            flow.Approve()
            let work = []string{
                "work",
                "owner/project#1",
                "--runs",
                Path.Combine(flow.Temp.Root, "runs"),
                "--harness",
                "codex",
                "--model",
                "gpt-6.1-sol",
                "--effort",
                "high",
                "--time",
                "30s",
                "--plain"
            }
            let declined = TestTerminal.Pty(binary, work, flow.Temp, 80, "\n")
            Check.That(declined.Code == 1, "Declined confirmation launched work")
            Check.Contains(declined.Output, "Start this donation? [y/N]")
            Check.Contains(declined.Output, "Task: owner/project #1")
            Check.Contains(declined.Output, "Model: gpt-6.1-sol")
            Check.Contains(declined.Output, "Effort: high")
            Check.Contains(declined.Output, "30 seconds total")
            flow.NoInference()
            flow.NoPr()
            flow.Mode("model_failure")
            let confirmed = TestTerminal.Pty(binary, work, flow.Temp, 80, "y\n")
            Check.That(confirmed.Code == 8, confirmed.Output + confirmed.Error)
            flow.NoInference()
            flow.CoordinatePosted()
            let run = Directory.GetDirectories(Path.Combine(flow.Temp.Root, "runs"))[0]
            Check.Contains(flow.Call([]string{"work", "--run", run, "--yes"}, 1).Error, "Codex failed")
            flow.Reload()
            Check.That(
                Check.Text(flow.State["exec_count"]) == "1",
                "Confirmed terminal work retried or did not execute"
            )
            Check.That(
                Check.Text(flow.State["requested_model"]) == "gpt-6.1-sol" && Check.Text(
                    flow.State["requested_effort"]
                ) == "model_reasoning_effort=\"high\"",
                "Confirmation forwarded the wrong tuple"
            )
        }

        private func VersionTwo(binary string) {
            using let coordination = CoordinationFlow(binary)
            coordination.Initialize()
            coordination.Claim()
            let flow = coordination.Flow
            Set(flow)
            let args = List[string]{
                "claim",
                "owner/project#1",
                "--time",
                "30s",
                "--runs",
                Path.Combine(flow.Temp.Root, "runs"),
                "--non-interactive"
            }
            let declared = Path.Combine(flow.Temp.Root, "managed-tools.json")
            File.WriteAllText(
                declared,
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
            )
            let conflict = List[string](args)
            conflict.AddRange([]string{"--tools", declared, "--effort", "xhigh"})
            Check.Contains(flow.Call(conflict.ToArray(), 1).Error, "no model substitution")
            let prepared = flow.Call(args.ToArray())
            let run = prepared.Output.Substring(prepared.Output.LastIndexOf("Run: ") + 5).Trim()
            let saved = Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))
            Check.That(
                Check.Text(saved["selection"]?["source"]) == "saved donor default",
                "V2 preparation did not use default"
            )
            Check.That(saved["tools"]?.AsArray().Count == 1, "V2 default invented tool declarations")
            flow.Mode("model_failure")
            let result = TestProcess.Run(binary, []string{"work", "--run", run, "--non-interactive"}, flow.Temp.Env)
            Check.That(result.Code == 1, "Synthetic model failure succeeded")
            Check.Contains(result.Error, "Codex failed")
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "V2 saved default required extra consent")
            flow.NoPr()
            let policyPath = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(policyPath))
            policy["allowed_tools"] = Check.Json("[{\"harness\":\"claude\",\"provider\":\"anthropic\"}]")
            File.WriteAllText(policyPath, policy.ToJsonString())
            flow.Commit("Owner rejects managed provider")
            Check.Contains(flow.Call([]string{"defaults", "check", "owner/project"}, 1).Error, "No eligible pair")
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Rejected tool policy spent extra inference")
        }

        private func ModelPolicy(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            let path = Path.Combine(flow.Upstream, ".github/tokate.json")
            let policy = Check.Json(File.ReadAllText(path))
            Check.SetModels(policy, nil)
            File.WriteAllText(path, policy.ToJsonString())
            flow.Commit("Unrestricted model policy")
            Select(flow, []string{}, 1)
            let explicitChoice = Select(flow, []string{"--model", "gpt-6.1-sol", "--effort", "xhigh"})
            Check.That(Check.Text(explicitChoice["effort"]) == "xhigh", "Unrestricted explicit effort changed")
            Set(flow)
            let saved = Select(flow, []string{})
            Check.That(Check.Text(saved["source"]) == "saved donor default", "Unrestricted default rejected")
            Select(flow, []string{"--effort", "xhigh"})
            let unavailable = Select(flow, []string{"--availability", "unavailable"}, 1)
            Check.Contains(Check.Text(unavailable["error"]), "donor-reported unavailable")
            let unsupported = Select(flow, []string{"--model", "outside-catalog", "--effort", "high"}, 1)
            Check.Contains(Check.Text(unsupported["error"]), "offline native Codex catalog")
            for effort in[]string{"absent", "unknown"} {
                let settings = Check.Json(File.ReadAllText(Settings(flow)))
                settings["effort"] = JsonValue.Create(effort)
                File.WriteAllText(Settings(flow), settings.ToJsonString())
                let rejected = Select(flow, []string{}, 1)
                Check.Contains(Check.Text(rejected["error"]), "known model")
            }
            flow.Call([]string{"defaults", "remove"})
            flow.NoInference()
            flow.NoPr()
        }

        private func Structured(binary string) {
            using let flow = NativeFixture(binary)
            let path = flow.Temp.Env["PATH"]
            flow.Temp.Env["PATH"] = "/empty"
            let missing = Check.Envelope(flow.Call([]string{"defaults", "show", "--json"}), "defaults", "ok")
            Check.That(missing["data"]?["default"] == nil, "Missing JSON defaults fabricated")
            let saved = Check.Envelope(
                flow.Call([]string{"defaults", "set", "--model", "gpt-6.1-sol", "--effort", "high", "--json"}),
                "defaults",
                "ok"
            )
            Check.That(
                Check.Text(saved["data"]?["default"]?["harness"]) == "codex" && Check.Text(
                    saved["data"]?["default"]?["provider"]
                ) == "openai" &&
                    Check.Text(saved["data"]?["default"]?["model"]) == "gpt-6.1-sol" && Check.Text(
                    saved["data"]?["default"]?["effort"]
                ) == "high",
                "Shorthand JSON defaults dropped the Codex tuple"
            )
            for pair in[][]string{
                []string{"--harness=codex", "codex", "openai"},
                []string{"--provider=openai", "codex", "openai"},
                []string{"--harness=claude", "claude", "anthropic"},
                []string{"--provider=anthropic", "claude", "anthropic"},
                []string{"--harness=pi", "pi", "local-chat-completions"},
                []string{"--provider=local-chat-completions", "pi", "local-chat-completions"}
            } {
                let args = List[string]{
                    "defaults",
                    "set",
                    "inferred",
                    pair[0],
                    "--model=gpt-6.1-sol",
                    pair[1] == "pi" ? "--effort=absent": "--effort=high",
                    "--json"
                }
                if pair[1] == "pi" {
                    args.Add("--endpoint=http://127.0.0.1:12345/v1")
                }
                let inferred = flow.Call(args.ToArray())
                let choice = Check.Envelope(inferred, "defaults", "ok")["data"]?["default"]
                Check.That(
                    Check.Text(choice?["harness"]) == pair[1] && Check.Text(choice?["provider"]) == pair[2],
                    "Defaults did not infer the missing known counterpart"
                )
                Check.That(!inferred.Output.Contains("127.0.0.1"), "Inferred Pi defaults exposed the endpoint")
            }
            let explicitPair = Check
                .Envelope(
                flow.Call(
                    []string{
                        "defaults",
                        "set",
                        "explicit",
                        "--harness=codex",
                        "--provider=local-chat-completions",
                        "--model=gpt-6.1-sol",
                        "--effort=high",
                        "--json"
                    }
                ),
                "defaults",
                "ok"
            )["data"]?["default"]
            Check.That(
                Check.Text(explicitPair?["harness"]) == "codex" && Check.Text(
                    explicitPair?["provider"]
                ) == "local-chat-completions",
                "Defaults replaced an explicit harness/provider pair"
            )
            let original = File.ReadAllText(Settings(flow))
            for rejected in[][]string{
                []string{"--harness=pi", "--model=gpt-6.1-sol", "--effort=absent"},
                []string{
                    "--harness=codex",
                    "--provider=local-chat-completions",
                    "--model=gpt-6.1-sol",
                    "--effort=high",
                    "--endpoint=http://127.0.0.1:12345/v1"
                }
            } {
                let args = List[string]{"defaults", "set", "--json"}
                args.AddRange(rejected)
                flow.Call(args.ToArray(), 1)
                Check.That(File.ReadAllText(Settings(flow)) == original, "Rejected defaults changed saved preferences")
            }
            flow.Temp.Env["PATH"] = path
            flow.Initialize()
            ExpandPolicy(flow)
            Set(flow, profile: "cloud")
            let profilePath = Path.Combine(flow.Temp.Env["HOME"], ".local/state/tokate/donor-profiles/cloud.json")
            let originalProfile = File.ReadAllText(profilePath)
            let profiled = Check.Envelope(
                flow.Call([]string{"defaults", "check", "owner/project", "cloud", "--json"}),
                "defaults",
                "ok"
            )
            Check.That(
                Check.Text(profiled["data"]?["source"]) == "saved donor profile cloud",
                "Named selection lost its source"
            )
            let overridden = Check.Envelope(
                flow.Call([]string{"defaults", "check", "owner/project", "cloud", "--effort", "xhigh", "--json"}),
                "defaults",
                "ok"
            )
            Check.That(
                Check.Text(overridden["data"]?["effort"]) == "xhigh" && Check.Text(overridden["data"]?["source"]) ==
                "saved donor profile cloud with explicit overrides" && File.ReadAllText(profilePath) == originalProfile,
                "Named profile override changed saved preferences or source"
            )
            flow.Reload()
            let calls = flow.State["api_calls"]?.DeepClone()
            for rejected in[]string{"missing", "--harness=pi", "--provider=local-chat-completions"} {
                let args = List[string]{"defaults", "check", "owner/project", "--json"}
                if rejected != "missing" {
                    args.Add("cloud")
                }
                args.Add(rejected)
                Check.Envelope(flow.Call(args.ToArray(), 1), "defaults", "error", "command_failed")
            }
            flow.Reload()
            Check.That(JsonNode.DeepEquals(calls, flow.State["api_calls"]), "Rejected profile reached GitHub")
            for args in[][]string{
                []string{"work", "--run", "unused", "--profile", "cloud", "--json"},
                []string{"claim", "owner/project#1", "--source", "external", "--tools", "unused", "cloud", "--json"}
            } {
                Check.Envelope(flow.Call(args, 1), args[0], "error", "invalid_arguments")
            }
            for availability in[]string{"unknown", "available"} {
                let selected = Check.Envelope(
                    flow.Call([]string{"defaults", "check", "owner/project", "--availability", availability, "--json"}),
                    "defaults",
                    "ok"
                )
                Check.That(
                    Check.Text(selected["data"]?["model"]) == "gpt-6.1-sol" && Check.Text(
                        selected["data"]?["policy_eligible"]
                    ) == "true",
                    "JSON selection dropped evidence"
                )
            }
            Check.Envelope(
                flow.Call(
                    []string{
                        "defaults",
                        "check",
                        "owner/project",
                        "--model",
                        "gpt-6.1-sol",
                        "--effort",
                        "high",
                        "--availability",
                        "unavailable",
                        "--json"
                    },
                    1
                ),
                "defaults",
                "error",
                "command_failed"
            )
            let removed = Check.Envelope(flow.Call([]string{"defaults", "remove", "--json"}), "defaults", "ok")
            Check.That(Check.Text(removed["data"]?["removed"]) == "true", "JSON defaults removal missing")
            let command = "'" + binary + "' defaults check owner/project --json 2> '" + Path.Combine(
                flow.Temp.Root,
                "diagnostics"
            ) +
                "'"
            let terminal = TestProcess.Run(
                "/usr/bin/script",
                []string{"-q", "-e", "-c", command, "/dev/null"},
                flow.Temp.Env
            )
            Check.Envelope(terminal, "defaults", "error", "invalid_arguments")
            Check.Contains(terminal.Output, "Pass --harness HARNESS")
            Check.Contains(terminal.Output, "Eligible pairs by harness/provider: codex/openai: ")
            Check.That(!terminal.Output.Contains("Choice number"), "JSON terminal selection prompted")
            flow.NoInference()
        }

        private func StateLocation(binary string) {
            using let temp = Temp()
            temp.Env["PATH"] = "/empty"
            for profile in[]string{"", "shared"} {
                let args = List[string]{"defaults", "set", "--model", "gpt-6.1-sol", "--effort", "high"}
                if profile != "" {
                    args.Add(profile)
                }
                CliDiscovery.Call(binary, args.ToArray(), temp)
            }
            let previous = Path.Combine(temp.Env["HOME"], ".local/state/tokate")
            let oldHash = Check.Hash(Path.Combine(previous, "donor-defaults.json"))
            let stateHome = Path.Combine(temp.Root, "new state")
            temp.Env["XDG_STATE_HOME"] = stateHome
            Check.Contains(CliDiscovery.Call(binary, []string{"defaults", "show", "shared"}, temp).Output, "high")
            for profile in[]string{"", "shared"} {
                let args = List[string]{"defaults", "set", "--model", "gpt-6.1-sol", "--effort", "xhigh"}
                if profile != "" {
                    args.Add(profile)
                }
                CliDiscovery.Call(binary, args.ToArray(), temp)
            }
            let current = Path.Combine(stateHome, "tokate")
            Check.That(File.Exists(Path.Combine(current, "donor-defaults.json")), "State override was ignored")
            Check.That(
                Check.Hash(Path.Combine(previous, "donor-defaults.json")) == oldHash,
                "Old defaults were migrated"
            )
            let listed = Check.Json(CliDiscovery.Call(binary, []string{"defaults", "list"}, temp).Output)
            Check.That(listed["profiles"]?.AsObject().Count == 1, "Duplicate profile names were listed")
            Check.That(
                Check.Text(listed["profiles"]?["shared"]?["effort"]) == "xhigh",
                "Old profile overrode current choice"
            )
            for invalid in[]string{"", "relative-state"} {
                temp.Env["XDG_STATE_HOME"] = invalid
                let read = Check.Json(CliDiscovery.Call(binary, []string{"defaults", "show"}, temp).Output)
                Check.That(
                    Check.Text(read["default"]?["effort"]) == "high",
                    "Empty or relative state override changed lookup"
                )
            }
            temp.Env["XDG_STATE_HOME"] = stateHome
            CliDiscovery.Call(binary, []string{"defaults", "remove", "shared"}, temp)
            Check.That(
                !File.Exists(Path.Combine(current, "donor-profiles/shared.json")) && !File.Exists(
                    Path.Combine(previous, "donor-profiles/shared.json")
                ),
                "Removed profile reappeared from previous storage"
            )
            let path = Path.Combine(current, "donor-defaults.json")
            File.Delete(path)
            File.CreateSymbolicLink(path, Path.Combine(previous, "donor-defaults.json"))
            CliDiscovery.Call(binary, []string{"defaults", "show"}, temp, 1)
            Check.That(
                Check.Hash(Path.Combine(previous, "donor-defaults.json")) == oldHash,
                "Linked defaults were changed"
            )
            Console.WriteLine(
                "PASS state directory override, previous profile lookup, precedence, explicit removal and link refusal"
            )
        }

        internal func All(binary string, selected string = "") {
            if selected != "" {
                if selected == "StateLocation" {
                    StateLocation(binary)
                } else if selected == "Structured" {
                    Structured(binary)
                    Console.WriteLine(
                        "PASS structured defaults/selection, availability and terminal no-prompt contract"
                    )
                } else if selected == "ModelPolicy" {
                    ModelPolicy(binary)
                    Console.WriteLine(
                        "PASS unrestricted explicit/default/terminal selection, known controls and no fallback"
                    )
                } else if selected == "InteractiveChoices" {
                    InteractiveChoices(binary)
                    Console.WriteLine("PASS terminal selection requires flags; zero inference before consent")
                } else {
                    throw Exception("Unknown selection test group")
                }
                return
            }

            Structured(binary)
            StateLocation(binary)
            Console.WriteLine("PASS structured defaults/selection, availability and terminal no-prompt contract")
            LocalSettings(binary)
            Console.WriteLine("PASS donor defaults set/read/remove and nonsecret storage")
            Choices(binary)
            Console.WriteLine("PASS default/override/refusal, capabilities and availability; zero inference")
            ConfirmationAndRuns(binary)
            Console.WriteLine("PASS pinned runs, capability revalidation and no model fallback")
            InteractiveChoices(binary)
            Console.WriteLine("PASS terminal selection requires flags; zero inference before consent")
            VersionTwo(binary)
            ModelPolicy(binary)
            Console.WriteLine("PASS unrestricted explicit/default/terminal selection, known controls and no fallback")
            Console.WriteLine("PASS V2 authorized defaults, exact tool policy and declaration conflicts")
        }
    }
}
