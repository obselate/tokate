package Tokate

import Gsharp.Concurrency
import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text.Json

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

            Output.Sink.Step(
                run.Flag("gratis") ? "Checking donor login...": "Checking owner approval and donor login..."
            )
        }

        private func Authenticate(run Data, options Args, policy Policy, harness string, codex bool) Harness {
            SelectionPolicy.Revalidate(run, policy)

            Output.Sink.ConfirmSelection(options, J.Get(run.Element(), "selection"), run)

            RuntimeBudget.Validate(run)

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
                run.Fields["failure_reason"] = Output.Sink.FailureCode
            }

            run.Save(directory)
        }

        private func SaveEvidence(
            directory string,
            run Data,
            record JsonElement,
            policy Policy,
            adapter Harness,
            result CommandResult,
            timer Stopwatch
        ) Evidence {
            run.Fields["output_truncated"] = result.OutputTruncated
            run.Fields["error_truncated"] = result.ErrorTruncated
            run.Fields["inference_exit_code"] = result.Code

            let evidence = adapter.Read.Invoke(
                directory,
                run,
                record,
                result,
                name -> policy.AllowsModel(run.Text("harness"), run.Text("provider"), name)
            )

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

                let record = ContributionAuthority.Recheck(run)
                let policy = Policy(J.Write(J.Get(record, "policy")))
                policy.Digest = run.Text("policy_hash")
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
                let prepared = adapter.Prepare.Invoke(directory, run, record, coding, policy.AllowedModels)
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
                        Output.Sink.Step(
                            "Running " + run.Text("model") + " / " + run.Text("effort") + ": " + allowance + "..."
                        )
                        timer.Restart()
                    }

                    inferenceStarted = true
                    Output.Sink.FailureCode = "inference_failed"
                    var result CommandResult
                    {
                        using let progress = Output.Sink.Progress(
                            adapter.Label,
                            coding,
                            RuntimeBudget(timer, totalSeconds)
                        )
                        var activity Action[string]? = nil

                        if Output.Sink.Active() {
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
                            Output.Sink.Step("Running " + String.Join(" ", prepared.Item1) + "...")
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

                    let evidence = SaveEvidence(directory, run, record, policy, adapter, result, timer)

                    Output.Sink.FailureCode = "invalid_state"
                    Contribution.Finish(directory, run, record, evidence.Usage, timer, seconds, reserve)
                } catch (error Exception) when ExecutionFailure.Handled(error) {
                    if codex && !inferenceStarted {
                        throw error
                    }

                    RecordFailure(directory, run, codex, error)

                    throw ExecutionFailure.From(error, Output.Sink.FailureCode)
                }
            } catch (error Exception) when error is IOException ||
                error is UnauthorizedAccessException ||
                error is JsonException {
                throw ExecutionFailure.From(error, "command_failed")
            }
        }
    }
}
