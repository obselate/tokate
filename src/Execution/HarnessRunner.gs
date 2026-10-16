package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Evidence {
    internal var Report string = ""
    internal var Usage Dictionary[string, Object?] = map[string, Object?]{}
    internal var Model string? = nil
}

internal class Harness(
    title string,
    billing string,
    provider string,
    hint string,
    label string,
    prepare Func[string, Data, JsonElement, RuntimeBudget, ValueTuple[[]string, Dictionary[string, Object?]?]],
    read Func[string, Data, JsonElement, CommandResult, Evidence],
    activity Action[string],
    choose Func[Args, Policy, string, JsonElement]? = nil,
    validateSaved Action[Data]? = nil,
    doctor Action[Args, ToolCheck]? = nil,
    beforeRun Action[Data, RuntimeBudget]? = nil,
    pair Func[string, string, bool]? = nil,
    options[]string? = nil,
    tools[]string? = nil,
    catalog bool = false,
    continues bool = true,
    nix string = "",
    installer string = "",
    config string = ""
) {
    internal let Title string = title
    internal let Billing string = billing
    internal let Provider string = provider
    internal let Hint string = hint
    internal let Label string = label
    internal let Prepare Func[
        string,
        Data,
        JsonElement,
        RuntimeBudget,
        ValueTuple[[]string, Dictionary[string, Object?]?]
    ] = prepare
    internal let Read Func[string, Data, JsonElement, CommandResult, Evidence] = read
    internal let Activity Action[string] = activity
    internal let Select Func[Args, Policy, string, JsonElement]? = choose
    internal let ValidateSaved Action[Data]? = validateSaved
    internal let Doctor Action[Args, ToolCheck]? = doctor
    internal let BeforeRun Action[Data, RuntimeBudget]? = beforeRun
    internal let Pair Func[string, string, bool]? = pair
    internal let Options[]string = options ?? []string{}
    internal let Tools[]string = tools ?? []string{}
    internal let Catalog bool = catalog
    internal let Continues bool = continues
    internal let Nix string = nix
    internal let Installer string = installer
    internal let Config string = config

    shared {
        internal let Table Dictionary[string, Harness] = map[string, Harness]{
            "codex": Harness(
                "Codex",
                "Subscription",
                "openai",
                "Add native Linux x64 Codex or the @openai/codex npm launcher with its matching codex-linux-x64 native runtime to PATH; user-local installations are supported. Use --harness-path FILE for a custom location.",
                "Inference",
                Worker.Prepare,
                Worker.Read,
                Worker.Activity,
                nix: "nixpkgs#codex",
                config: ".codex"
            ),
            "pi": Harness(
                "Pi",
                "Local",
                "local-chat-completions",
                "Use --harness-path FILE, or --pi-root DIR and --node FILE for an existing installation.",
                "Pi inference",
                PiHarness.Prepare,
                PiHarness.Read,
                PiHarness.Activity,
                PiHarness.Select,
                PiHarness.ValidateSaved,
                PiHarness.Doctor,
                PiHarness.BeforeRun,
                options: []string{"endpoint", "pi-root", "node"},
                tools: []string{"/bin/bash"},
                catalog: true,
                nix: "github:earendil-works/pi/stable",
                installer: "https://pi.dev/install.sh"
            ),
            "claude": Harness(
                "Claude Code",
                "Subscription",
                "anthropic",
                "Use an installed Claude Code with its existing login.",
                "Claude inference",
                ClaudeHarness.Prepare,
                ClaudeHarness.Read,
                ClaudeHarness.Activity,
                ClaudeHarness.Select,
                ClaudeHarness.ValidateSaved,
                ClaudeHarness.Doctor,
                pair: ClaudeCode.Pair,
                options: []string{"claude-profile"},
                tools: []string{"/bin/bash", "bwrap", "socat"},
                continues: false
            ),
            "omp": Harness(
                "OMP",
                "",
                "",
                "Install OMP with its official installer and sign in, or use --harness-path FILE.",
                "OMP inference",
                OmpHarness.Prepare,
                OmpHarness.Read,
                OmpHarness.Activity,
                OmpHarness.Select,
                OmpHarness.ValidateSaved,
                OmpHarness.Doctor,
                catalog: true
            )
        }

        internal func Find(name string) Harness? -> Table.ContainsKey(name) ? Table[name]: nil

        internal func DefaultProvider(name string) string -> Find(name)?.Provider ?? ""

        internal func Accepts(name string, provider string) bool -> Find(name) is Harness adapter &&
            (adapter.Provider == "" || adapter.Provider == provider)

        internal func Describe(name string, provider string) string {
            let billing = Find(name)?.Billing ?? ""
            return (Find(name)?.Title ?? name) + " (" + (billing == "" ? provider: billing) + ")"
        }

        internal func Owns(name string, option string) bool {
            let options = Find(name)?.Options ?? []string{}
            return Array.IndexOf(options, option) >= 0
        }

        internal func Resumes(name string, provider string) bool -> Find(name)?.Continues == true &&
            Accepts(name, provider)
    }
}

internal class HarnessRunner {
    shared {
        private func ValidateUnexecuted(directory string, run Data) {
            if run.Number("version") != 2 || run.Text("source") != "tokate" {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "External work uses external --run; inference is never launched"
                )
            }

            if run.Text("state") != "claimed" {
                throw CliFailure(
                    "invalid_state",
                    "This claim has already run. Use submit for publication, or request a new coding attempt."
                )
            }

            var started = File.Exists(Path.Combine(directory, "events.jsonl")) || File.Exists(
                Path.Combine(directory, "report.md")
            )

            for name in Harness.Table.Keys {
                started = started || run.Fields.ContainsKey(name + "_version")
            }

            if started {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "This destination attempt already started execution; no second inference is allowed"
                )
            }
        }

        private func Authenticate(run Data, options Args, policy Policy, harness string, codex bool) Harness {
            let adapter = policy.Adapter(harness, run.Text("provider")) ??
                throw Exception("Unsupported managed harness/provider")

            if codex {
                let harnessPath = run.Text("harness_path")

                if options.Get("harness-path") != "" && options.Get("harness-path") != harnessPath {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "The saved run fixes its harness path; use that path or start a fresh claim"
                    )
                }

                Worker.Authenticate(run)
            }

            if (harness == "pi" || harness == "omp") && run.Number("preparation_version") != 1 {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Managed " + (harness == "omp" ? "OMP": "pi") + " requires a prepared version-2 contribution"
                )
            }

            return adapter
        }

        private func RecordFailure(directory string, run Data, codex bool, error Exception) {
            if run.Text("failure_stage") == "inference" {
                if let result = Commands.InterruptedResult(error) {
                    run.Fields["failure_reason"] = "inference_interrupted"
                    run.Fields["output_truncated"] = result.OutputTruncated
                    run.Fields["error_truncated"] = result.ErrorTruncated
                }
            }

            run.Transition("failed")
            run.Fields["error"] = error.Message

            if codex && !run.Fields.ContainsKey("failure_reason") {
                run.Fields["failure_reason"] = PublicOutput.FailureCode
            }

            run.Save(directory)
        }

        private func SaveEvidence(
            directory string,
            run Data,
            record JsonElement,
            adapter Harness,
            result CommandResult,
            timer Stopwatch
        ) Evidence {
            run.Fields["output_truncated"] = result.OutputTruncated
            run.Fields["error_truncated"] = result.ErrorTruncated
            run.Fields["inference_exit_code"] = result.Code

            let evidence = adapter.Read.Invoke(directory, run, record, result)

            File.WriteAllText(Path.Combine(directory, "report.md"), evidence.Report)

            run.Fields["reported_model"] = evidence.Model
            run.Fields["turn_completed"] = true
            run.Fields["usage"] = evidence.Usage
            run.Fields["execution_seconds"] = Convert.ToInt32(timer.Elapsed.TotalSeconds)

            run.Save(directory)

            return evidence
        }

        internal func Execute(directory string, options Args) {
            try {
                using let lease = RunStorage.Lease(directory)
                let run = Data.Load(directory)

                ValidateUnexecuted(directory, run)

                Terminal.Step(
                    run.Flag("gratis") ? "Checking donor login...": "Checking owner approval and donor login..."
                )

                let record = ContributionAuthority.Recheck(run)
                let policy = Policy(J.Write(J.Get(record, "policy")))
                policy.Digest = run.Text("policy_hash")
                SelectionPolicy.Revalidate(run, policy)

                DonorSelection.Confirm(options, J.Get(run.Element(), "selection"), run)

                RuntimeBudget.Validate(run)

                let harness = run.Text("harness")
                let codex = harness == "codex"
                let adapter = Authenticate(run, options, policy, harness, codex)

                let seconds = run.Number("seconds")
                let reserve = run.Number("verification_reserve")
                let totalSeconds = run.Flag("unlimited") ? 0: seconds
                let timer = Stopwatch.StartNew()
                let coding = RuntimeBudget(timer, seconds - reserve)
                let checkout = Path.Combine(directory, "checkout")

                WorkspacePreparation.Ready(directory, run)
                let prepared = adapter.Prepare.Invoke(directory, run, record, coding)
                ContributionAuthority.Recheck(run)
                WorkspacePreparation.Ready(directory, run)

                var inferenceStarted = false

                try {
                    adapter.BeforeRun?.Invoke(run, coding)

                    if let fields = prepared.Item2 {
                        for (name, value) in fields {
                            run.Fields[name] = value
                        }
                    }

                    run.Transition("running")
                    run.Fields["failure_stage"] = "inference"
                    run.Fields["failure_reason"] = "inference_failed"
                    run.Save(directory)

                    if codex {
                        let allowance = RuntimeBudget.Description(run)
                        Terminal.Step(
                            "Running " + run.Text("model") + " / " + run.Text("effort") + ": " + allowance + "..."
                        )
                        timer.Restart()
                    }

                    inferenceStarted = true
                    PublicOutput.FailureCode = "inference_failed"
                    var result CommandResult
                    {
                        using let progress = TerminalProgress(adapter.Label, coding, RuntimeBudget(timer, totalSeconds))
                        var activity Action[string]? = nil

                        if DonationView.Active() {
                            activity = adapter.Activity
                        }

                        let prompt = TaskContext.Build(checkout, run, record, coding)

                        if harness == "command" {
                            File.WriteAllText(Path.Combine(directory, "prompt.md"), prompt)
                        }

                        if codex {
                            Verification.Validate(checkout)
                        }

                        if harness == "command" {
                            Terminal.Step("Running " + String.Join(" ", prepared.Item1) + "...")
                        }

                        result = Commands.Run(
                            LocalPaths.NeedSystemTool("env", codex ? directory: checkout),
                            prepared.Item1,
                            checkout,
                            prompt,
                            totalSeconds,
                            harness: codex,
                            cancellation: Chan[bool](1),
                            strictOutput: !codex,
                            outputPath: Path.Combine(directory, "events.jsonl"),
                            errorPath: Path.Combine(directory, "stderr.log"),
                            budget: coding,
                            outputLine: activity
                        )
                    }

                    let evidence = SaveEvidence(directory, run, record, adapter, result, timer)

                    PublicOutput.FailureCode = "invalid_state"
                    Contribution.Finish(directory, run, record, evidence.Usage, timer, seconds, reserve)
                } catch (error Exception) when ExecutionFailure.Handled(error) {
                    if codex && !inferenceStarted {
                        throw error
                    }

                    RecordFailure(directory, run, codex, error)

                    throw ExecutionFailure.From(error, PublicOutput.FailureCode)
                }
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "command_failed")
            }
        }
    }
}
