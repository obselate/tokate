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
            if run.Version != Data.FormatVersion || run.Source != "tokate" {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "External work uses external --run; inference is never launched"
                )
            }

            if run.State != "claimed" {
                throw CliFailure(
                    "invalid_state",
                    "This claim has already run. Use submit for publication, or request a new coding attempt."
                )
            }

            var started = File.Exists(Path.Combine(directory, "events.jsonl")) || File.Exists(
                Path.Combine(directory, "report.md")
            )

            for name in Harness.Table.Keys {
                started = started || run.HasHarnessVersion(name)
            }

            if started {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "This destination attempt already started execution; no second inference is allowed"
                )
            }

            Output.Sink.Step(run.Gratis ? "Checking donor login...": "Checking owner approval and donor login...")
        }

        private func Authenticate(run Data, options Args, policy Policy, harness string, codex bool) Harness {
            SelectionPolicy.Revalidate(run, policy)

            Output.Sink.ConfirmSelection(options, run.Selection, run)

            RuntimeBudget.Validate(run)

            let adapter = policy.Adapter(harness, run.Provider) ??
                throw Exception("Unsupported managed harness/provider")

            if codex {
                let harnessPath = run.HarnessPath

                if options.Get("harness-path") != "" && options.Get("harness-path") != harnessPath {
                    throw ExecutionFailure.Create(
                        "invalid_state",
                        "The saved run fixes its harness path; use that path or start a fresh claim"
                    )
                }

                Worker.Authenticate(run)
            }

            if (harness == "pi" || harness == "omp") && run.PreparationVersion != Data.PreparationFormatVersion {
                throw ExecutionFailure.Create(
                    "invalid_state",
                    "Managed " + (harness == "omp" ? "OMP": "pi") + " requires a prepared version-2 contribution"
                )
            }

            return adapter
        }

        private func RecordFailure(directory string, run Data, codex bool, error Exception) {
            if run.FailureStage == "inference" {
                if let result = Commands.InterruptedResult(error) {
                    run.FailureReason = "inference_interrupted"
                    run.OutputTruncated = result.OutputTruncated
                    run.ErrorTruncated = result.ErrorTruncated
                }
            }

            run.Transition("failed")
            run.Error = error.Message

            if codex && !run.HasFailureReason {
                run.FailureReason = Output.Sink.FailureCode
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
            run.OutputTruncated = result.OutputTruncated
            run.ErrorTruncated = result.ErrorTruncated
            run.InferenceExitCode = result.Code

            let evidence = adapter.Read.Invoke(
                directory,
                run,
                record,
                result,
                name -> policy.AllowsModel(run.Harness, run.Provider, name)
            )

            File.WriteAllText(Path.Combine(directory, "report.md"), evidence.Report)

            run.ReportedModel = evidence.Model
            run.TurnCompleted = true
            run.Usage = J.Parse(J.Write(evidence.Usage))
            run.ExecutionSeconds = Convert.ToInt32(timer.Elapsed.TotalSeconds)

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
                policy.Digest = run.PolicyHash
                let harness = run.Harness
                let codex = harness == "codex"
                let adapter = Authenticate(run, options, policy, harness, codex)

                let seconds = run.Seconds
                let reserve = run.VerificationReserve
                let totalSeconds = run.Unlimited ? 0: seconds
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

                    prepared.Item2?.Invoke(run)

                    run.Transition("running")
                    run.FailureStage = "inference"
                    run.FailureReason = "inference_failed"
                    run.Save(directory)

                    if codex {
                        let allowance = RuntimeBudget.Description(run)
                        Output.Sink.Step("Running " + run.Model + " / " + run.Effort + ": " + allowance + "...")
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
                        let activity Action[string]? = Output.Sink.Active() ? adapter.Activity: nil

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
