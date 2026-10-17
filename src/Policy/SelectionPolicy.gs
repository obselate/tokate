package Tokate

import System
import System.Collections.Generic
import System.Text.Json

internal class SelectionPolicy {
    shared {
        internal func NormalizePair(args Args) {
            if args.Get("harness") == "" && args.Get("provider") == "" {
                args.Values["--harness"] = "codex"
            }

            for (name, adapter) in Harness.Table {
                if adapter.Provider == "" {
                    continue
                }
                if args.Get("harness") == name && args.Get("provider") == "" {
                    args.Values["--provider"] = adapter.Provider
                } else if args.Get("harness") == "" && args.Get("provider") == adapter.Provider {
                    args.Values["--harness"] = name
                }
            }
        }

        private func CodexChoices(
            capabilities Dictionary[string, HashSet[string]],
            policy Policy,
            unavailable string = ""
        ) SortedSet[string] {
            let choices = SortedSet[string](StringComparer.Ordinal)

            for entry in capabilities {
                for effort in entry.Value {
                    if entry.Key != unavailable && policy.Allows("codex", "openai", entry.Key, effort) {
                        choices.Add(entry.Key + " / " + effort)
                    }
                }
            }

            return choices
        }

        private func Eligible(args Args, policy Policy) string {
            let groups = List[string]()

            for tool in policy.AllowedTools {
                let models = tool.Models
                let pairs = List[string]()

                if tool.Harness == "codex" {
                    pairs.AddRange(CodexChoices(CodexRuntime.Capabilities(args.Get("harness-path")), policy))
                } else if let entries = models {
                    for model in entries {
                        for effort in model.Value {
                            pairs.Add(model.Key + " / " + effort)
                        }
                    }
                } else {
                    pairs.Add("any model")
                }

                groups.Add(
                    tool.Harness + "/" + tool.Provider + ": " + (pairs.Count == 0 ? "none": String.Join(", ", pairs))
                )
            }

            return String.Join("; ", groups)
        }

        internal func Resolve(args Args, policy Policy) JsonElement {
            if args.Get("harness") == "" && args.Get("provider") == "" && args.Get("model") == "" && args.Get(
                "effort"
            ) == "" {
                throw CliFailure(
                    "invalid_arguments",
                    "No usable saved default. Pass --harness HARNESS --model MODEL --effort EFFORT. Eligible pairs by harness/provider: " +
                        Eligible(args, policy) +
                        ". No inference started."
                )
            }

            NormalizePair(args)

            let harness = args.Get("harness", "codex")

            ChooseProvider(args, policy, harness)

            let provider = args.Get("provider", "openai")

            if !Harness.Owns(harness, "claude-profile") && (args.Get("claude-profile") != "") {
                throw Exception("Claude profile options require the claude harness")
            }

            if !Harness.Owns(harness, "endpoint") &&
                (args.Get("endpoint") != "" || args.Get("pi-root") != "" || args.Get("node") != "") {
                throw Exception("Pi runtime options require the pi harness")
            }

            let saved = args.SavedDefaults
            let compatible = J.Text(saved, "harness") == harness && J.Text(saved, "provider") == provider
            let model = args.Get("model", compatible ? J.Text(saved, "model"): "")
            let effort = args.Get("effort", compatible ? J.Text(saved, "effort"): "")
            let explicitPair = args.Get("model") != "" || args.Get("effort") != ""
            var overridden = explicitPair

            for key in[]string{"endpoint", "pi-root", "node", "harness-path", "claude-profile"} {
                overridden = overridden || (args.Get(key) != "" && args.Get(key) != J.Text(saved, key))
            }

            let source = args.Get("profile") != "" ? "saved donor profile " + args.Get("profile") +
                (overridden ? " with explicit overrides": ""): (
                explicitPair ? "explicit invocation": "saved donor default"
            )

            let adapter = policy.Adapter(harness, args.Get("provider")) ??
                throw Exception("Unsupported managed harness/provider")
            if let choose = adapter.Select {
                if model != "" {
                    args.Values["--model"] = model
                }
                if effort != "" {
                    args.Values["--effort"] = effort
                }

                return choose(args, () -> Selection(args, policy, source))
            }

            let capabilities = CodexRuntime.Capabilities(args.Get("harness-path"))
            let availability = args.Get("availability", "unknown")
            let choices = CodexChoices(capabilities, policy, availability == "unavailable" ? model: "")

            if choices.Count == 0 {
                throw Exception(
                    "No eligible pair: the intersection of exact owner policy and offline harness capabilities is empty after excluding donor-reported unavailable models. Other model availability is unknown. No inference started."
                )
            }

            if !choices.Contains(model + " / " + effort) {
                var rejection = "Incomplete donor model/effort choice."
                if model != "" && effort != "" {
                    var supported HashSet[string]

                    try {
                        policy.Validate("codex", provider, model, effort, 1)
                        rejection = !capabilities.TryGetValue(model, out supported) || !supported.Contains(effort) ?
                        model +
                            " / " +
                            effort +
                            " is not in the offline native Codex catalog. Availability is unknown.":
                        "Model is donor-reported unavailable."
                    } catch (error Exception) {
                        rejection = error.Message
                    }
                }

                let guidance = (
                    explicitPair &&
                        model != "" &&
                        effort != "" ? " Choose an eligible pair.": " Explicit donor choice required: --model MODEL --effort EFFORT."
                ) +
                    " Eligible pairs: " +
                    String.Join(", ", choices) + ". No inference started."
                if (explicitPair || args.Get("profile") != "") && model != "" && effort != "" {
                    throw CliFailure("command_failed", rejection + guidance)
                }

                let reason = if saved.ValueKind != JsonValueKind.Undefined {
                    compatible ? "Saved default rejected: " + rejection:
                    "Saved default harness/provider does not match the selected codex/openai harness."
                } else {
                    "No usable saved default."
                }

                throw CliFailure("invalid_arguments", reason + guidance)
            }

            args.Values["--model"] = model
            args.Values["--effort"] = effort
            let selected = Selection(args, policy, source)
            selected[
                "capability"
            ] = "compatible: native Codex explicit controls and offline bundled model/effort catalog"
            selected["availability"] = availability == "unknown" ? "unknown": "donor-reported " + availability
            selected[
                "availability_evidence"
            ] = "No account availability probe; catalog presence, PATH and login do not prove availability"
            return J.Parse(J.Write(selected))
        }

        private func ChooseProvider(args Args, policy Policy, harness string) {
            if (Harness.Find(harness)?.Provider == "" || harness == "command") && args.Get("provider") == "" {
                let allowed = policy.Providers(harness)
                let name = Harness.Find(harness)?.Title ?? "the command harness"

                if allowed.Count != 1 {
                    throw CliFailure(
                        "invalid_arguments",
                        "Choose --provider for " +
                            name +
                            ": the owner policy allows " +
                            (allowed.Count == 0 ? "no " + name + " provider": String.Join(", ", allowed)) +
                            ". No inference started."
                    )
                }

                args.Values["--provider"] = allowed[0]
            }
        }

        internal func Selection(args Args, policy Policy, source string) Dictionary[string, Object?] {
            policy.Validate(args.Need("harness"), args.Need("provider"), args.Need("model"), args.Need("effort"), 1)
            if args.Get("availability") == "unavailable" {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Selected model is donor-reported unavailable; no retry or fallback"
                )
            }

            return map[string, Object?]{
                "harness": args.Need("harness"),
                "provider": args.Need("provider"),
                "model": args.Need("model"),
                "effort": args.Need("effort"),
                "source": source,
                "policy_hash": policy.Digest,
                "policy_eligible": true
            }
        }

        internal func Revalidate(run Data, policy Policy) {
            let selected = run.Selection

            if selected.ValueKind != JsonValueKind.Object {
                throw Exception("Managed runs require saved selection metadata; start a fresh claim")
            }

            let harness = J.Text(selected, "harness")
            let provider = J.Text(selected, "provider")
            let failure = "Saved selection differs from run or policy; no model substitution is allowed"
            if harness != run.Harness || provider != run.Provider || J.Text(selected, "model") != run.Model || J.Text(
                selected,
                "effort"
            ) != run.Effort {
                throw Exception(failure)
            }

            if run.Version != 2 || J.Text(selected, "policy_hash") != policy.Digest {
                throw Exception(failure)
            }

            policy.Validate(harness, provider, run.Model, run.Effort, run.Seconds)
            let adapter = policy.Adapter(harness, provider)
            if let validate = adapter?.ValidateSaved {
                validate(run)
            }
            if adapter?.Select != nil {
                return
            }

            let capabilities = CodexRuntime.Capabilities(run.HarnessPath)
            var supported HashSet[string]

            if !capabilities.TryGetValue(run.Model, out supported) || !supported.Contains(run.Effort) {
                throw Exception("Saved model/effort is no longer compatible with native Codex. No retry or fallback.")
            }

            if J.Text(selected, "availability") == "donor-reported unavailable" {
                throw Exception("Selected model is donor-reported unavailable. No retry or fallback.")
            }
        }
    }
}
