package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

internal class Harness {
    internal let Label string
    internal let Prepare Func[
        string,
        Data,
        JsonElement,
        RuntimeBudget,
        ValueTuple[[]string, Dictionary[string, Object?]?]
    ]
    internal let Read Func[string, Data, JsonElement, CommandResult, Dictionary[string, Object?]]
    internal let Activity Action[string]
    internal let BeforeRun Action[Data, RuntimeBudget]?

    internal init(
        label string,
        prepare Func[string, Data, JsonElement, RuntimeBudget, ValueTuple[[]string, Dictionary[string, Object?]?]],
        read Func[string, Data, JsonElement, CommandResult, Dictionary[string, Object?]],
        activity Action[string],
        beforeRun Action[Data, RuntimeBudget]? = nil
    ) {
        Label = label
        Prepare = prepare
        Read = read
        Activity = activity
        BeforeRun = beforeRun
    }
}

internal class HarnessRunner {
    shared {
        private let Adapters Dictionary[string, Harness] = map[string, Harness]{
            "codex": Harness("Inference", Worker.Prepare, Worker.Read, Worker.Activity),
            "claude": Harness("Claude inference", ClaudeHarness.Prepare, ClaudeHarness.Read, ClaudeHarness.Activity),
            "pi": Harness("Pi inference", PiHarness.Prepare, PiHarness.Read, PiHarness.Activity, PiHarness.BeforeRun),
            "omp": Harness("OMP inference", OmpHarness.Prepare, OmpHarness.Read, OmpHarness.Activity)
        }

        internal func Execute(directory string, options Args) {
            try {
                using let lease = RunStorage.Lease(directory)
                let run = Data.Load(directory)

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
                for name in Adapters.Keys {
                    started = started || run.Fields.ContainsKey(name + "_version")
                }
                if started {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "This destination attempt already started execution; no second inference is allowed"
                    )
                }

                Terminal.Step("Checking owner approval and donor login...")

                let record = ContributionAuthority.Recheck(run)
                let policy = Policy(J.Write(J.Get(record, "policy")), gratis: run.Flag("gratis"))
                policy.Digest = run.Text("policy_hash")
                DonorSelection.Revalidate(run, policy)

                let selected = J.Get(run.Element(), "selection")

                if AttemptContinuation.Has(run) {
                    AttemptContinuation.Confirm(options, selected)
                } else {
                    DonorSelection.Confirm(options, selected)
                }

                RuntimeBudget.Validate(run)

                let harness = run.Text("harness")
                let adapter = harness == "command" ? CommandHarness.Adapter(
                    policy.Tool(harness, run.Text("provider"))
                ): Adapters[harness]
                let codex = harness == "codex"
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
                    run.Fields["state"] = "running"
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
                    run.Fields["output_truncated"] = result.OutputTruncated
                    run.Fields["error_truncated"] = result.ErrorTruncated
                    run.Fields["inference_exit_code"] = result.Code
                    let usage = adapter.Read.Invoke(directory, run, record, result)
                    run.Fields["turn_completed"] = true
                    run.Fields["usage"] = usage
                    run.Fields["execution_seconds"] = Convert.ToInt32(timer.Elapsed.TotalSeconds)
                    run.Save(directory)
                    PublicOutput.FailureCode = "invalid_state"
                    Contribution.Finish(directory, run, record, usage, timer, seconds, reserve)
                } catch (error Exception) when ExecutionFailure.Handled(error) {
                    if codex && !inferenceStarted {
                        throw error
                    }
                    if run.Text("failure_stage") == "inference" {
                        if let result = Commands.InterruptedResult(error) {
                            run.Fields["failure_reason"] = "inference_interrupted"
                            run.Fields["output_truncated"] = result.OutputTruncated
                            run.Fields["error_truncated"] = result.ErrorTruncated
                        }
                    }
                    run.Fields["state"] = "failed"
                    run.Fields["error"] = error.Message
                    if codex && !run.Fields.ContainsKey("failure_reason") {
                        run.Fields["failure_reason"] = PublicOutput.FailureCode
                    }
                    run.Save(directory)
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
