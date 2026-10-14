package TokateTests

import System
import System.Collections.Generic
import System.IO
import System.Linq
import System.Text.Json.Nodes
import Tokate

internal class AmendmentFlow {
    shared {
        private func Saved(run string) JsonNode -> Check.Json(File.ReadAllText(Path.Combine(run, "run.json")))

        private func Amend(
            flow NativeFixture,
            run string,
            commit string,
            code int32 = 0,
            tools string = "",
            owner bool = false,
            summary bool = true,
            json bool = false,
            head bool = false
        ) Result {
            let args = List[string]{"amend", "--run", run, "--time", "30s"}
            if !head {
                args.AddRange([]string{"--commit", commit})
            }
            if tools != "" {
                args.AddRange([]string{"--tools", tools})
            }
            if summary {
                args.AddRange(
                    []string{
                        "--summary",
                        PublishedContribution.Summary(
                            flow,
                            commit,
                            "Update reviewed result content for this amendment."
                        )
                    }
                )
            }
            if json {
                args.Add("--json")
            }
            return flow.Call(args.ToArray(), code, owner: owner)
        }

        private func Edit(
            flow NativeFixture,
            run string,
            text string = "Reviewed correction\n",
            file string = "result.txt"
        ) string {
            let external = Check.Text(Saved(run)["source"]) == "external"
            let checkout = Path.Combine(run, external ? "coding": "checkout")
            if external {
                flow.Git("-C", checkout, "fetch", Path.Combine(run, "checkout"), "HEAD")
                flow.Git("-C", checkout, "checkout", "--detach", "FETCH_HEAD")
            }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.Combine(checkout, file)) ?? checkout)
            File.WriteAllText(Path.Combine(checkout, file), text)
            flow.Git("-C", checkout, "add", "-A")
            flow.DonorGit(checkout, "commit", "-m", "Review correction")
            return flow.Git("-C", checkout, "rev-parse", "HEAD")
        }

        private func Review(flow NativeFixture) {
            flow.Reload()
            let pull = flow.State["pulls"]?[0] ?? throw Exception("Missing review PR")
            let body = Check.Text(pull["body"])
            pull["body"] = JsonValue.Create("Owner review before\n" + body + "\nOwner review after")
            flow.Save()
        }

        private func AssertOriginal(run string, original string) {
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/run.json")) == original,
                "Original run evidence changed"
            )
            for check in Saved(Path.Combine(run, "original-evidence"))["verification"]?.AsArray() ?? JsonArray() {
                for field in[]string{"output_file", "error_file"} {
                    let relative = Check.Text(check[field])
                    Check.That(relative != "", "Original check lacks recorded evidence")
                    Check.That(
                        File
                            .ReadAllBytes(Path.Combine(run, relative))
                            .AsSpan()
                            .SequenceEqual(File.ReadAllBytes(Path.Combine(run, "original-evidence", relative))),
                        "Original verification artifact lost: " + relative
                    )
                }
            }
            Check.That(
                File.Exists(Path.Combine(run, "original-evidence/manifest.json")),
                "Original archive is unsealed"
            )
            let before = Check.Json(original)
            let after = Saved(run)
            for field in[]string{
                "version",
                "approval",
                "model",
                "effort",
                "seconds",
                "usage",
                "elapsed_seconds",
                "source",
                "tools",
                "verification"
            } {
                Check.That(
                    Check.Text(before[field]) == Check.Text(after[field]),
                    "Original field reinterpreted: " + field
                )
            }
            for file in[]string{
                "events.jsonl",
                "changes.patch",
                "verification.json",
                "pr-body.md",
                "publication.json"
            } {
                if File.Exists(Path.Combine(run, file)) {
                    Check.That(
                        File.ReadAllText(Path.Combine(run, file)) == File.ReadAllText(
                            Path.Combine(run, "original-evidence", file)
                        ),
                        "Original evidence overwritten: " + file
                    )
                }
            }
        }

        private func ForkIdentity(binary string) {
            using let prepared = PublishedContribution.Create(binary, external: true)
            let flow = prepared.Coordination.Flow
            let run = prepared.Run
            let commit = Edit(flow, run)
            RepositoryFaults.Reject(
                flow,
                run,
                []string{"amend", "--run", run, "--commit", commit, "--time", "30s"},
                repositoryError: "identity changed"
            )
            Check.That(!Directory.Exists(Path.Combine(run, "amendments", commit)), "Fork refusal created an amendment")
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "", "Fork refusal launched inference")
            Check.That(
                Check.Text(flow.State["pulls"]?[0]?["head"]?["sha"]) == Check.Text(Saved(run)["commit"]),
                "Fork refusal changed published head"
            )
        }

        private func ArchiveIntegrity(binary string) {
            using let prepared = PublishedContribution.Create(binary)
            let flow = prepared.Coordination.Flow
            let run = prepared.Run
            for fault in[]string{
                "record",
                "verification-directory",
                "verification-file",
                "broken-verification",
                "missing-verification",
                "archive-directory"
            } {
                prepared.Restore()
                let original = File.ReadAllText(Path.Combine(run, "run.json"))
                let commit = Edit(flow, run)
                let secret = Path.Combine(flow.Temp.Root, "outside-evidence")
                File.WriteAllText(secret, "synthetic private evidence")
                let evidence = Directory.GetDirectories(run, "verification-*")[0]
                switch fault {
                    case "record" {
                        let record = Path.Combine(run, "report.md")
                        File.Delete(record)
                        File.CreateSymbolicLink(record, secret)
                    }
                    case "verification-directory" {
                        Directory.Delete(evidence, true)
                        Directory.CreateSymbolicLink(evidence, flow.Temp.Root)
                    }
                    case "verification-file", "broken-verification" {
                        let output = Path.Combine(evidence, "stdout.log")
                        File.Delete(output)
                        File.CreateSymbolicLink(output, fault == "verification-file" ? secret: secret + "-missing")
                    }
                    case "missing-verification" {
                        File.Delete(Path.Combine(evidence, "stdout.log"))
                    }
                    case "archive-directory" {
                        Directory.CreateSymbolicLink(Path.Combine(run, "original-evidence"), flow.Temp.Root)
                    }
                }
                Amend(flow, run, commit, 1)
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == original,
                    "Linked evidence rewrote saved run"
                )
                Check.That(
                    !Directory.Exists(Path.Combine(run, "amendments", commit)),
                    "Linked evidence reached verification"
                )
                Check.That(
                    Directory.GetDirectories(run, "archive-*").Length == 0,
                    "Rejected archive left partial staging"
                )
                Check.That(File.ReadAllText(secret) == "synthetic private evidence", "Archive changed linked target")
                flow.Reload()
                Check.That(Check.Text(flow.State["exec_count"]) == "1", "Archive refusal repeated inference")
            }
            prepared.Restore()
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let commit = Edit(flow, run)
            Amend(flow, run, commit)
            AssertOriginal(run, original)
            let archive = Path.Combine(run, "original-evidence")
            let saved = File.ReadAllText(Path.Combine(run, "run.json"))
            let manifest = File.ReadAllText(Path.Combine(archive, "manifest.json"))
            let secret = Path.Combine(flow.Temp.Root, "outside-evidence")
            File.WriteAllText(secret, "synthetic private evidence")
            using let amended = FixtureSnapshot(flow.Temp.Root)
            for fault in[]string{"record-link", "verification-link", "tampered", "missing", "unsealed"} {
                amended.Restore()
                flow.Reload()
                switch fault {
                    case "record-link" {
                        let record = Path.Combine(archive, "report.md")
                        File.Delete(record)
                        File.CreateSymbolicLink(record, secret)
                    }
                    case "verification-link" {
                        let evidence = Directory.GetDirectories(archive, "verification-*")[0]
                        Directory.Delete(evidence, true)
                        Directory.CreateSymbolicLink(evidence, flow.Temp.Root)
                    }
                    case "tampered" {
                        let evidence = Directory.GetDirectories(archive, "verification-*")[0]
                        File.AppendAllText(Path.Combine(evidence, "stdout.log"), "Changed original evidence")
                    }
                    case "missing" {
                        Directory.Delete(Directory.GetDirectories(archive, "verification-*")[0], true)
                    }
                    case "unsealed" {
                        File.Delete(Path.Combine(archive, "manifest.json"))
                        File.Delete(Path.Combine(archive, "seal.json"))
                        for evidence in Directory.EnumerateDirectories(archive) {
                            Directory.Delete(evidence, true)
                        }
                    }
                }
                Amend(flow, run, commit, 1)
                let second = Edit(flow, run, "Another amendment\n")
                Amend(flow, run, second, 1)
                Check.That(File.ReadAllText(Path.Combine(run, "run.json")) == saved, "Changed archive was accepted")
                Check.That(
                    fault == "unsealed" ? !File.Exists(Path.Combine(archive, "manifest.json")):
                    File.ReadAllText(Path.Combine(archive, "manifest.json")) == manifest,
                    "Changed archive was resealed"
                )
                Check.That(File.ReadAllText(secret) == "synthetic private evidence", "Archive followed linked path")
                flow.Reload()
                Check.That(Check.Text(flow.State["exec_count"]) == "1", "Archive validation repeated inference")
            }
            amended.Restore()
            flow.Reload()
            using let second = PublishedContribution.Create(binary)
            let otherFlow = second.Coordination.Flow
            let otherRun = second.Run
            Amend(otherFlow, otherRun, Edit(otherFlow, otherRun))
            Directory.Delete(archive, true)
            Directory.Move(Path.Combine(otherRun, "original-evidence"), archive)
            Amend(flow, run, commit, 1)
            Amend(flow, run, Edit(flow, run, "Another amendment\n"), 1)
            Check.That(
                File.ReadAllText(Path.Combine(run, "run.json")) == saved,
                "Another run's sealed archive was accepted"
            )
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Archive identity check repeated inference")
        }

        private func ReceiptAuthority(binary string) {
            using let prepared = PublishedContribution.Create(binary)
            let flow = prepared.Coordination.Flow
            let run = prepared.Run
            let commit = Edit(flow, run)
            Amend(flow, run, commit)
            flow.CoordinatePosted()
            Amend(flow, run, commit)
            using let snapshot = FixtureSnapshot(flow.Temp.Root)
            for field in[]string{"issue", "head", "approval", "reservation", "expected", "amendment"} {
                snapshot.Restore()
                flow.Reload()
                let location = Path.Combine(run, "amendments", commit)
                let saved = Saved(location)
                let body = Check.Text(saved["body"])
                let start = body.IndexOf("<!-- tokate-receipt:") + "<!-- tokate-receipt:".Length
                let encoded = body.Substring(start, body.IndexOf(" -->", start) - start)
                let receipt = Check.Json(encoded)
                if field == "issue" {
                    receipt[field] = JsonValue.Create(999)
                } else if field == "amendment" {
                    (receipt[field] ?? throw Exception("Missing amendment"))["seconds"] = JsonValue.Create(31)
                } else {
                    receipt[field] = JsonValue.Create(
                        field == "head" || field == "original_head" ? String('b', 40):
                        "changed"
                    )
                }
                let altered = body.Replace(encoded, receipt.ToJsonString())
                saved["body"] = JsonValue.Create(altered)
                File.WriteAllText(Path.Combine(location, "run.json"), saved.ToJsonString())
                (flow.State["pulls"]?[0] ?? throw Exception("Missing PR"))["body"] = JsonValue.Create(altered)
                flow.Save()
                let original = File.ReadAllText(Path.Combine(run, "run.json"))
                flow.ResetTraffic()
                flow.Call([]string{"verify", "owner/project#10"}, 1)
                if field == "amendment" {
                    Check.Envelope(
                        flow.Call([]string{"verify", "owner/project#10", "--json"}, 1),
                        "verify",
                        "error",
                        "stale_approval"
                    )
                }
                Check.That(File.ReadAllText(Path.Combine(run, "run.json")) == original, "Altered receipt was accepted")
                flow.Reload()
                for call in flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(Check.Text(call["method"]) == "GET", "Receipt refusal attempted publication")
                }
                Check.That(Check.Text(flow.State["exec_count"]) == "1", "Receipt refusal repeated inference")
            }
        }

        private func AssertPublished(
            flow NativeFixture,
            run string,
            commit string,
            owner bool = false,
            summary bool = true
        ) {
            Check.That(Check.Text(Saved(run)["commit"]) == commit, "Saved amendment head differs")
            let change = Saved(Path.Combine(run, "amendments", commit))
            Check.That(
                Check.Text(change["snapshot"]) != "" && change["tree"] == nil && change["patch_sha256"] == nil,
                "Published amendment changed the saved snapshot format"
            )
            let replay = Path.Combine(flow.Temp.Root, "amendment-replay-" + commit)
            flow.Git("clone", "--no-local", Path.Combine(run, "checkout"), replay)
            flow.Git("-C", replay, "checkout", "--detach", Check.Text(Saved(run)["base"]))
            flow.Git("-C", replay, "apply", "--index", Path.Combine(run, "amendments", commit, "candidate.patch"))
            Check.That(
                flow.Git("-C", replay, "write-tree") == flow.Git("-C", replay, "rev-parse", commit + "^{tree}"),
                "Amendment patch changed the tree"
            )
            flow.Reload()
            Check.That(flow.State["pulls"]?.AsArray().Count == 1, "Amendment duplicated PR")
            let body = Check.Text(flow.State["pulls"]?[0]?["body"])
            Check.Contains(body, "Owner review before")
            Check.Contains(body, "Owner review after")
            Check.Contains(body, "cover original work only")
            Check.Contains(body, commit)
            Check.That(!body.Contains("synthetic-raw-"), "Detailed evidence was published")
            Check.Envelope(flow.Call([]string{"verify", "owner/project#10", "--json"}, owner: owner), "verify", "ok")
            flow.State["checks"] = Check.Json("[{\"name\":\"verify\",\"bucket\":\"pass\",\"state\":\"SUCCESS\"}]")
            flow.Save()
            let checks = flow.Call([]string{"checks", "--run", run}, summary ? 0: 1, owner: owner)
            if !summary {
                Check.Contains(checks.Error, "PR report has no change summary for this candidate")
            }
            Check.That(
                Check.Text(Check.Json(File.ReadAllText(Path.Combine(run, "checks.json")))["head"]) == commit,
                "Owner checks were not bound to amendment"
            )
        }

        private func InterruptedVerification(binary string) {
            using let flow = NativeFixture(binary)
            let run = PublishedContribution.Original(flow, interruptible: true)
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let commit = Edit(flow, run, "slow-check", "slow")
            let args = []string{"amend", "--run", run, "--commit", commit, "--time", "1s", "--json"}
            let failure = flow.Call(args, 1)
            Check.That(
                Check.Text(Check.Json(failure.Output)["error"]?["code"]) == "verification_failed",
                "Amendment interruption lost its structured failure classification"
            )
            Check.That(
                !(failure.Output + failure.Error).Contains("synthetic-amendment"),
                "Raw amendment output escaped"
            )
            let location = Path.Combine(run, "amendments", commit)
            let saved = Saved(location)
            Check.That(Check.Text(saved["state"]) == "failed", "Amendment failure state lost")
            Check.That(Check.Text(saved["failure_reason"]) == "verification_failed", "Amendment failure reason lost")
            Check.That(saved["verification"]?.AsArray().Count == 2, "Amendment prior or active check lost")
            Check.That(Check.Text(saved["verification"]?[0]?["exit_code"]) == "0", "Amendment prior pass lost")
            Check.That(saved["verification"]?[1]?["exit_code"] == nil, "Interrupted amendment fabricated exit code")
            Check.Contains(Check.Text(saved["verification"]?[1]?["output"]), "synthetic-amendment-prefix")
            Check.Contains(Check.Text(saved["verification"]?[1]?["error"]), "synthetic-amendment-error")
            let evidence = File.ReadAllText(Path.Combine(location, "run.json"))
            flow.Call(args, 1)
            Check.That(
                File.ReadAllText(Path.Combine(location, "run.json")) == evidence,
                "Interrupted amendment retried checks"
            )
            AssertOriginal(run, original)
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Amendment launched inference")
            Check.That(
                Check.Text(flow.State["pulls"]?[0]?["head"]?["sha"]) == Check.Text(Check.Json(original)["commit"]),
                "Failed amendment changed remote PR"
            )
        }

        private func Rejections(binary string) {
            using let preparation = PublishedContribution.Create(binary, mutating: true)
            for failure in[]string{
                "unchanged",
                "empty-commit",
                "protected",
                "protected-unicode",
                "protected-template",
                "hidden-index",
                "dirty",
                "changed-head",
                "remote",
                "issue",
                "revoked",
                "superseded",
                "tools",
                "budget",
                "mutating-check",
                "closed",
                "merged"
            } {
                preparation.Restore()
                let flow = preparation.Coordination.Flow
                let run = preparation.Run
                let before = Check.Text(Saved(run)["commit"])
                var commit = failure == "unchanged" ||
                    failure == "empty-commit" ? before: Edit(
                    flow,
                    run,
                    "Reviewed\n",
                    failure == "protected" ? ".github/workflows/review.yml":
                    failure == "protected-unicode" ? ".github/workflows/é.yml":
                    failure == "protected-template" ? ".github/tokate-pr.md": "result.txt"
                )
                var tools string = ""
                if failure == "empty-commit" {
                    flow.DonorGit(Path.Combine(run, "checkout"), "commit", "--allow-empty", "-m", "Empty amendment")
                    commit = flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD")
                } else if failure == "hidden-index" {
                    flow.Git("-C", Path.Combine(run, "checkout"), "update-index", "--assume-unchanged", "result.txt")
                    File.AppendAllText(Path.Combine(run, "checkout/result.txt"), "Hidden edit")
                } else if failure == "dirty" {
                    File.AppendAllText(Path.Combine(run, "checkout/result.txt"), "Dirty")
                } else if failure == "changed-head" {
                    Edit(flow, run, "Different head\n")
                } else if failure == "remote" {
                    flow.Git(
                        "-C",
                        Path.Combine(run, "checkout"),
                        "push",
                        Path.Combine(flow.Bin, "fork"),
                        "HEAD:refs/heads/" + Check.Text(Saved(run)["branch"])
                    )
                } else if failure == "issue" || failure == "revoked" {
                    flow.Reload()
                    let issue = flow.State["issue"] ?? throw Exception("Missing issue")
                    if failure == "issue" {
                        issue["body"] = JsonValue.Create("Changed acceptance")
                    } else {
                        issue["labels"] = JsonArray()
                    }
                    flow.Save()
                } else if failure == "superseded" {
                    flow.Approve()
                } else if failure == "tools" {
                    tools = Path.Combine(flow.Temp.Root, "bad-tools.json")
                    File.WriteAllText(
                        tools,
                        "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
                    )
                } else if failure == "budget" {
                    let rejected = Check.Envelope(
                        flow.Call([]string{"amend", "--run", run, "--commit", commit, "--time", "3601s", "--json"}, 1),
                        "amend",
                        "error",
                        "stale_approval"
                    )
                    Check.That(
                        Check.Text(
                            rejected["error"]?["message"]
                        ) == "Amendment verification budget exceeds owner policy",
                        "JSON amendment lost the owner budget reason"
                    )
                    continue
                } else if failure == "closed" || failure == "merged" {
                    flow.Reload()
                    let pull = flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
                    pull[failure == "closed" ? "state": "merged"] = failure == "closed" ? JsonValue.Create(
                        "closed"
                    ): JsonValue.Create(true)
                    flow.Save()
                } else if failure == "mutating-check" {
                    let amended = Edit(flow, run, "Trigger candidate mutation", "mutate")
                    Amend(flow, run, amended, 1)
                    let saved = Saved(Path.Combine(run, "amendments", amended))
                    Check.That(
                        Check.Text(saved["failure_stage"]) == "changed_candidate" && Check.Text(
                            saved["failure_reason"]
                        ) == "candidate_changed",
                        "Verifier mutation did not fail candidate validation"
                    )
                    Check.That(
                        flow.Git("-C", Path.Combine(run, "checkout"), "status", "--porcelain") == "",
                        "Verification changed the original candidate checkout"
                    )
                    continue
                }
                let rejected = Amend(flow, run, commit, 1, tools, json: failure == "dirty")
                if failure == "dirty" {
                    let value = Check.Envelope(rejected, "amend", "error", "invalid_state")
                    Check.That(
                        Check.Text(
                            value["error"]?["message"]
                        ) == "Amend requires a clean checkout at the declared exact commit",
                        "JSON amendment lost the exact checkout reason"
                    )
                }
                if failure == "unchanged" || failure == "empty-commit" {
                    Check.Contains(
                        rejected.Error,
                        "The commit has no file changes compared with the published commit. Edit and commit the saved checkout first."
                    )
                    Check.That(
                        !Directory.Exists(Path.Combine(run, "amendments", commit)),
                        "Unchanged amendment reached verification"
                    )
                }
                Check.That(Check.Text(Saved(run)["commit"]) == before, "Rejected amendment changed saved publication")
                Check.That(Directory.Exists(Path.Combine(run, "checkout")), "Rejected amendment deleted checkout")
            }
        }

        private func V2(binary string, mode string = "", native bool = false, modelPolicy string = "") {
            using let flow = CoordinationFixture(binary)
            let run = PublishedContribution.PublishRun(flow, native, modelPolicy)
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let contribution = Check.Text(flow.State()["state"]?["contribution"])
            Review(flow.Flow)
            let commit = Edit(flow.Flow, run)
            if !native {
                Check.That(
                    flow.Flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD") == Check.Text(
                        Check.Json(original)["commit"]
                    ),
                    "External amendment was copied into the verification checkout before amend"
                )
                Check.That(
                    TestProcess.Run(
                        "/usr/bin/git",
                        []string{"-C", Path.Combine(run, "checkout"), "cat-file", "-e", commit},
                        flow.Flow.Temp.Env
                    )
                        .Code != 0,
                    "External amendment candidate already exists in the verification checkout"
                )
            }
            if modelPolicy != "" {
                File.WriteAllText(
                    flow.Tools,
                    "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"model\":\"claude-sonnet-4-6\",\"effort\":\"absent\"}]"
                )
            }
            if mode == "recovery" {
                flow.Flow.Mode("lost_push_response")
                let rejected = Amend(flow.Flow, run, commit, 1, flow.Tools, summary: true)
                Check.That(
                    Check.Text(
                        Saved(Path.Combine(run, "amendments", commit))["failure_reason"]
                    ) == "publication_interrupted",
                    "Interrupted Git publication lost its saved failure reason"
                )
                Check.Contains(rejected.Error, "Saved amendment")
                Check.Contains(rejected.Error, "Re-run the same amend command")
                flow.Flow.Mode("")
            }
            let amended = Check.Envelope(
                Amend(
                    flow.Flow,
                    run,
                    commit,
                    tools: flow.Tools,
                    summary: true,
                    json: true,
                    head: mode == "" && !native
                ),
                "amend",
                "ok"
            )
            Check.That(Check.Text(amended["data"]?["commit"]) == commit, "Amendment JSON lost the resolved commit")
            Check.That(
                flow.Flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD") == commit,
                "Amend did not import the exact candidate into the verification checkout"
            )
            flow.Flow.Reload()
            let request = Check.PostedRequest(flow.Flow.State)
            Check.That(Check.Text(request["action"]) == "amend", "Wrong amendment request")
            Check.That(
                Check.Text(request["expected"]) != Check.Text(Saved(run)["state_sha"]),
                "Amend used stale original reservation revision"
            )
            Check.That(
                flow.Flow.State["request_comments"]?.AsArray().Count == 2,
                "Amendment repeated an applied request comment"
            )
            if mode == "" && !native {
                let location = Path.Combine(run, "amendments", commit)
                let saved = File.ReadAllText(Path.Combine(location, "run.json"))
                let summary = Check.Text(Saved(location)["summary_argument"])
                let summaryInput = File.ReadAllText(summary)
                let toolsInput = File.ReadAllText(flow.Tools)
                for key in[]string{"summary", "tools", "time", "sync"} {
                    let arguments = List[string]{
                        "amend",
                        "--run",
                        run,
                        "--commit",
                        commit,
                        "--time",
                        key == "time" ? "31s": "30s",
                        "--tools",
                        flow.Tools,
                        "--summary",
                        summary,
                        "--json"
                    }
                    let file = key == "summary" ? summary: flow.Tools
                    let originalInput = File.ReadAllText(file)
                    if key == "summary" || key == "tools" {
                        File.AppendAllText(file, "\n")
                    } else if key == "sync" {
                        arguments.AddRange([]string{"--sync", String('a', 40)})
                    }
                    let rejected = Check.Envelope(
                        flow.Flow.Call(arguments.ToArray(), 1),
                        "amend",
                        "error",
                        "invalid_state"
                    )
                    let message = Check.Text(rejected["error"]?["message"])
                    Check.Contains(message, "--" + key)
                    Check.Contains(message, "Restore the original input to continue")
                    Check.Contains(message, "start a new amendment with a new --commit and --time")
                    Check.That(
                        File.ReadAllText(Path.Combine(location, "run.json")) == saved,
                        "Changed inputs altered the saved request"
                    )
                    File.WriteAllText(file, originalInput)
                }
                File.WriteAllText(summary, "{}")
                let rejected = Check.Envelope(
                    flow.Flow.Call(
                        []string{
                            "amend",
                            "--run",
                            run,
                            "--commit",
                            commit,
                            "--time",
                            "30s",
                            "--tools",
                            flow.Tools,
                            "--summary",
                            summary,
                            "--json"
                        },
                        1
                    ),
                    "amend",
                    "error",
                    "invalid_state"
                )
                Check.Contains(Check.Text(rejected["error"]?["message"]), "--summary")
                File.Delete(summary)
                File.Delete(flow.Tools)
                flow.Flow.Call([]string{"amend", "--run", run, "--json"})
                Check.That(
                    File.ReadAllText(Path.Combine(location, "run.json")) == saved,
                    "Saved continuation changed the request"
                )
                flow.Flow.Reload()
                Check.That(
                    flow.Flow.State["request_comments"]?.AsArray().Count == 2,
                    "Saved continuation repeated the request"
                )
                File.WriteAllText(summary, summaryInput)
                File.WriteAllText(flow.Tools, toolsInput)
            }
            let path = flow.Event(request)
            if mode == "recovery" {
                flow.Flow.Mode("lost_body_response")
                flow.Coordinate(path, 1)
                flow.Flow.Call([]string{"verify", "owner/project#10"}, 1)
                flow.Flow.Mode("")
            }
            flow.Flow.ResetTraffic()
            flow.Coordinate(path)
            flow.Flow.Reload()
            if mode == "recovery" {
                for call in flow.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                    Check.That(
                        !(Check.Text(call["method"]) == "PATCH" && Check.Text(call["path"]).Contains("/pulls/")),
                        "Interrupted response repeated an applied body update"
                    )
                }
            }
            flow.Flow.ResetTraffic()
            flow.Coordinate(path)
            flow.Flow.Reload()
            for call in flow.Flow.State["api_calls"]?.AsArray() ?? JsonArray() {
                Check.That(Check.Text(call["method"]) == "GET", "Applied amendment request repeated writes")
            }
            let status = Check.Envelope(flow.Flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
            let pending = status["data"]?["amendment"]
            let previous = Check.Text(Check.Json(original)["commit"])
            Check.That(
                Check.Text(pending?["state"]) == "requested" && Check.Text(pending?["previous"]) == previous &&
                    Check.Text(pending?["commit"]) == commit,
                "Status omitted requested amendment commits"
            )
            Check.That(
                Check.Text(status["data"]?["commit"]) == previous && status["data"]?["amendments"] == nil,
                "Status reported an incomplete amendment as published"
            )
            Check.That(
                Check.Text(Saved(Path.Combine(run, "amendments", commit))["state"]) == "requested",
                "Status completed an amendment"
            )
            let next = status["data"]?["next"]
            Check.That(Check.Text(next?["role"]) == "donor", "Amendment completion responsibility missing")
            Check.Contains(Check.Text(next?["action"]), "re-run the same amend command")
            let command = next?["command"]?.AsArray() ?? throw Exception("Missing amendment completion command")
            Check.That(
                Check.Text(command[1]) == "amend" && Check.Text(command[3]) == run && Check.Text(
                    command[5]
                ) == commit &&
                    Check.Text(command[7]) == "30s",
                "Amendment completion command changed run, commit or budget"
            )
            Check.That(
                status["next_actions"]?.AsArray().Any(
                    action -> action?.ToJsonString() == command.ToJsonString()
                ) == true,
                "Amendment completion command missing from next actions"
            )
            if mode == "" && !native {
                let summary = Check.Text(Saved(Path.Combine(run, "amendments", commit))["summary_argument"])
                let summaryInput = File.ReadAllText(summary)
                let toolsInput = File.ReadAllText(flow.Tools)
                File.Delete(summary)
                File.Delete(flow.Tools)
                flow.Flow.Call([]string{"amend", "--run", run, "--json"})
                File.WriteAllText(summary, summaryInput)
                File.WriteAllText(flow.Tools, toolsInput)
            }
            flow.Flow.Call(command.Skip(1).Select(word -> Check.Text(word)).ToArray())
            let completed = Check.Envelope(flow.Flow.Call([]string{"status", "--run", run, "--json"}), "status", "ok")
            Check.That(
                completed["data"]?["amendment"] == nil && completed["data"]?["next"] == nil && Check.Text(
                    completed["data"]?["amendments"]?[0]?["head"]
                ) == commit,
                "Completed amendment retained pending guidance or lost publication"
            )
            AssertOriginal(run, original)
            AssertPublished(flow.Flow, run, commit)
            Check.That(
                Check.Text(flow.State()["state"]?["contribution"]) == contribution,
                "V2 original contribution reinterpreted"
            )
            Check.That(flow.State()["state"]?["amendments"]?.AsArray().Count == 1, "V2 history missing")
            if mode == "" {
                let second = Edit(flow.Flow, run, "Second v2 correction\n")
                Amend(flow.Flow, run, second)
                flow.Flow.Reload()
                let nextRequest = Check.PostedRequest(flow.Flow.State)
                flow.Coordinate(flow.Event(nextRequest))
                Amend(flow.Flow, run, second)
                AssertPublished(flow.Flow, run, second)
                let current = Check.Envelope(
                    flow.Flow.Call([]string{"status", "owner/project#1", "--json"}),
                    "status",
                    "ok"
                )
                Check.That(
                    Check.Text(current["data"]?["coordination"]?["contribution"]?["head"]) == second,
                    "Structured coordination omitted current amended head"
                )
                Check.That(
                    flow.State()["state"]?["amendments"]?.AsArray().Count == 2,
                    "V2 continuation lost prior amendment"
                )
                Check.That(
                    Check.Text(flow.State()["state"]?["contribution"]) == contribution,
                    "V2 continuation changed original contribution"
                )
            }
            if native {
                Check.That(Check.Text(flow.Flow.State["exec_count"]) == "1", "Native amendment repeated inference")
            } else {
                flow.Flow.NoInference()
            }
        }

        private func V2Stale(binary string) {
            using let preparation = PublishedContribution.Create(binary, external: true)
            for failure in[]string{
                "expired",
                "superseded",
                "missing-reservation",
                "remote",
                "revoked-after-push",
                "stale-state",
                "expired-after-checks",
                "body-edited",
                "report-edited"
            } {
                preparation.Restore()
                let flow = preparation.Coordination
                let run = preparation.Run
                let commit = Edit(flow.Flow, run)
                if failure == "expired" {
                    flow.Expire()
                } else if failure == "superseded" || failure == "missing-reservation" {
                    flow.Flow.Approve()
                    if failure == "missing-reservation" {
                        let state = flow.State()["state"] ?? throw Exception("Missing state")
                        state.AsObject().Remove("reservation")
                        flow.RewriteState(state)
                    }
                } else if failure == "remote" {
                    flow.Flow.Git(
                        "-C",
                        Path.Combine(run, "coding"),
                        "push",
                        Path.Combine(flow.Flow.Bin, "fork"),
                        "HEAD:refs/heads/" + Check.Text(Saved(run)["branch"])
                    )
                } else if failure == "revoked-after-push" {
                    flow.Flow.Mode("revoke_after_push")
                }
                if failure == "stale-state" ||
                    failure == "body-edited" ||
                    failure == "expired-after-checks" ||
                    failure == "report-edited" {
                    Amend(flow.Flow, run, commit)
                    flow.Flow.Reload()
                    let request = Check.PostedRequest(flow.Flow.State)
                    if failure == "expired-after-checks" {
                        flow.Expire()
                    } else if failure == "stale-state" {
                        flow.RewriteState(flow.State()["state"] ?? throw Exception("Missing state"))
                    } else {
                        let pull = flow.Flow.State["pulls"]?[0] ?? throw Exception("Missing PR")
                        pull["body"] = JsonValue.Create(
                            failure == "report-edited" ?
                            Check.Text(pull["body"]).Replace(
                                "coordinator did not observe execution.",
                                "Incorrect attribution."
                            ):
                            Check.Text(pull["body"]).Replace("tokate-receipt:", "edited-receipt:")
                        )
                        flow.Flow.Save()
                    }
                    flow.Coordinate(flow.Event(request), 1)
                    Amend(flow.Flow, run, commit, 1)
                } else if failure == "superseded" || failure == "missing-reservation" {
                    let rejected = Amend(flow.Flow, run, commit, 1, json: true)
                    let result = Check.Envelope(rejected, "amend", "error", "stale_approval")
                    Check.Contains(
                        Check.Text(result["error"]?["message"]),
                        "The reservation is gone. Return to the owner."
                    )
                } else {
                    Amend(flow.Flow, run, commit, 1)
                }
                Check.That(Directory.Exists(Path.Combine(run, "checkout")), "Stale amendment deleted progress")
                flow.Flow.NoInference()
            }
        }

        private func Read(run string, file string = "run.json") JsonNode -> Check.Json(
            File.ReadAllText(Path.Combine(run, file))
        )

        private func Once(flow NativeFixture, prs int32 = 0) {
            flow.Reload()
            Check.That(Check.Text(flow.State["exec_count"]) == "1", "Correction repeated inference")
            Check.That((flow.State["pulls"]?.AsArray().Count ?? 0) == prs, "Unexpected or duplicate PR")
        }

        internal func Correct(flow NativeFixture, run string, text string = "Explicit donor correction\n") string {
            File.WriteAllText(Path.Combine(run, "checkout/result.txt"), text)
            return Commit(flow, run)
        }

        private func Commit(flow NativeFixture, run string, message string = "Explicit correction") string {
            let checkout = Path.Combine(run, "checkout")
            flow.Git("-C", checkout, "add", "-A")
            flow.DonorGit(checkout, "commit", "--allow-empty", "-m", message)
            return flow.Git("-C", checkout, "rev-parse", "HEAD")
        }

        internal func Rework(
            flow NativeFixture,
            run string,
            commit string,
            code int32 = 0,
            tools string = "",
            seconds string = "30",
            json bool = false
        ) Result {
            let args = List[string]{"amend", "--run", run, "--commit", commit, "--time", seconds + "s"}
            if tools != "" {
                args.AddRange([]string{"--tools", tools})
            }
            if json {
                args.Add("--json")
            }
            return flow.Call(args.ToArray(), code)
        }

        private func ReworkAndSubmit(
            flow NativeFixture,
            run string,
            commit string,
            code int32 = 0,
            tools string = "",
            seconds string = "30",
            json bool = false
        ) Result {
            let result = Rework(flow, run, commit, code, tools, seconds, json)
            if code == 0 {
                flow.Publish(run)
            }
            return result
        }

        private func Prepared(flow NativeFixture, run string) string {
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let failed = File.Exists(Path.Combine(run, "verification.json")) ? File.ReadAllText(
                Path.Combine(run, "verification.json")
            ): ""
            let prepared = Check.Envelope(flow.Call([]string{"amend", "--run", run, "--json"}), "amend", "ok")
            Check.That(File.ReadAllText(Path.Combine(run, "run.json")) == original, "Preparation rewrote saved work")
            Check.That(!File.Exists(Path.Combine(run, "correction.json")), "Preparation created an attempt")
            let archive = Path.Combine(run, "original-evidence")
            Check.That(
                Check.Text(prepared["data"]?["artifacts"]?["original_evidence"]) == archive,
                "Prepared JSON lost original artifact"
            )
            Check.That(File.ReadAllText(Path.Combine(archive, "run.json")) == original, "Original record lost")
            for file in[]string{"events.jsonl", "report.md", "stderr.log"} {
                Check.That(
                    File.ReadAllText(Path.Combine(archive, file)) == File.ReadAllText(Path.Combine(run, file)),
                    "Original turn evidence lost: " + file
                )
            }
            if failed != "" {
                Check.That(File.ReadAllText(Path.Combine(archive, "verification.json")) == failed, "Prior checks lost")
            }
            let manifest = File.ReadAllText(Path.Combine(archive, "manifest.json"))
            flow.Call([]string{"amend", "--run", run})
            Check.That(
                File.ReadAllText(Path.Combine(archive, "manifest.json")) == manifest,
                "Preparation retry replaced original archive"
            )
            Once(flow)
            return manifest
        }

        private func Whitespace(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            Check.Contains(flow.Call([]string{"work", "--run", run}, 1).Error, "trailing whitespace")
            Check.That(
                !File.Exists(Path.Combine(run, "candidate.patch")),
                "Whitespace failure unexpectedly saved a candidate"
            )
            Check.That(
                !File.Exists(Path.Combine(run, "verification.json")),
                "Whitespace failure ran independent checks"
            )
            let checkout = Path.Combine(run, "checkout")
            File.AppendAllText(Path.Combine(checkout, "result.txt"), "Unstaged correction evidence\n")
            File.WriteAllText(Path.Combine(checkout, "untracked.bin"), "Untracked evidence\0bytes")
            let secret = Path.Combine(flow.Temp.Root, "private-evidence")
            File.WriteAllText(secret, "synthetic private data")
            File.CreateSymbolicLink(Path.Combine(checkout, "outside-link"), secret)
            let manifest = Prepared(flow, run)
            let archive = Path.Combine(run, "original-evidence")
            Check.Contains(
                File.ReadAllText(Path.Combine(archive, "staged.patch")),
                "Copied license with trailing whitespace \t"
            )
            Check.Contains(File.ReadAllText(Path.Combine(archive, "unstaged.patch")), "Unstaged correction evidence")
            Check.Contains(File.ReadAllText(Path.Combine(archive, "capture.json")), "candidate.patch")
            Check.Contains(
                File.ReadAllText(Path.Combine(archive, "capture.json")),
                "original model provenance is unproven"
            )
            Check.That(
                File.ReadAllText(Path.Combine(archive, "checkout/untracked.bin")) == "Untracked evidence\0bytes",
                "Untracked binary evidence lost"
            )
            Check.That(!File.Exists(Path.Combine(archive, "checkout/outside-link")), "Archive followed a symlink")
            Check.Contains(File.ReadAllText(Path.Combine(archive, "capture.json")), "outside-link")
            File.Delete(Path.Combine(checkout, "outside-link"))
            File.Delete(Path.Combine(checkout, "untracked.bin"))
            let commit = Correct(flow, run)
            let amended = Check.Envelope(
                flow.Call([]string{"amend", "--run", run, "--time", "30s", "--json"}),
                "amend",
                "ok"
            )
            Check.That(Check.Text(amended["data"]?["commit"]) == commit, "Amend without commit selected another head")
            let request = Read(run, "request.json")
            Check.That(
                Check.Text(request["action"]) == "publish" && Check.Text(
                    request["metadata"]?["correction"]?["head"]
                ) == commit,
                "Unpublished amend lost correction publication provenance"
            )
            flow.Publish(run)
            Once(flow, 1)
            Check.That(
                File.ReadAllText(Path.Combine(archive, "manifest.json")) == manifest,
                "Correction changed original archive"
            )
            Check.That(File.ReadAllText(secret) == "synthetic private data", "Capture changed private data")
            let saved = Read(run)
            Check.That(Check.Text(saved["commit"]) == commit, "Published another commit")
            Check.That(Check.Text(saved["correction"]?["head"]) == commit, "Receipt lost exact candidate")
            Check.That(
                saved["correction"]?["tools"]?.AsArray().Count == 0,
                "Missing tools did not declare manual editing"
            )
            Check.That(saved["previous_published_head"] == nil, "Unpublished candidate treated as previous PR")
            Check.Contains(flow.Body(), "manual/unknown")
            Check.Contains(flow.Body(), "cover only the original completed turn")
            Check.That(!flow.Body().Contains("Fresh attempt seeded"), "Ordinary correction invented interrupted origin")
            flow.Call([]string{"verify", "owner/project#10"}, owner: true)
            flow.Call([]string{"amend", "--run", run}, 1)
            ReworkAndSubmit(flow, run, commit, 1)
            Once(flow, 1)
        }

        private func Reconstruct(flow NativeFixture, run string, patch string, tree string, name string) {
            let replay = Path.Combine(flow.Temp.Root, name)
            flow.Git("clone", "--no-local", Path.Combine(run, "checkout"), replay)
            flow.Git("-C", replay, "checkout", "--detach", Check.Text(Read(run)["base"]))
            flow.Git("-C", replay, "apply", "--index", "--binary", patch)
            Check.That(flow.Git("-C", replay, "write-tree") == tree, "Binary patch did not reconstruct the exact tree")
        }

        private func BinaryRename(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            let asset = [14 * 1024 * 1024]byte
            Random(91).NextBytes(asset)
            File.WriteAllBytes(Path.Combine(flow.Upstream, "artwork.bin"), asset)
            flow.Commit("Retained binary artwork")
            flow.Git("-C", flow.Upstream, "push", Path.Combine(flow.Bin, "fork"), "main")
            flow.Approve()
            let run = flow.Claim("120")
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            let checkout = Path.Combine(run, "checkout")
            Directory.CreateDirectory(Path.Combine(checkout, "branding"))
            flow.Git("-C", checkout, "mv", "artwork.bin", "branding/artwork.bin")
            let originalTree = flow.Git("-C", checkout, "write-tree")
            Check.That(
                flow.Git("-C", checkout, "diff", "--cached", "--binary", "--full-index", "--no-renames").Length >
                32 * 1024 * 1024,
                "Binary move fixture did not exceed the former capture limit"
            )
            flow.Git("-C", checkout, "config", "diff.renames", "false")
            Prepared(flow, run)
            let archivedPatch = Path.Combine(run, "original-evidence/staged.patch")
            Check.Contains(File.ReadAllText(archivedPatch), "similarity index 100%")
            Reconstruct(flow, run, archivedPatch, originalTree, "original-replay")
            flow.Git("-C", checkout, "config", "diff.renames", "true")
            Check.That(
                flow.Git("-C", checkout, "diff", "--cached", "--binary", "--full-index", "--find-renames=100%") ==
                File.ReadAllText(archivedPatch).Trim(),
                "Original binary evidence depends on rename configuration"
            )
            let commit = Correct(flow, run)
            let tree = flow.Git("-C", checkout, "rev-parse", "HEAD^{tree}")
            ReworkAndSubmit(flow, run, commit, seconds: "120")
            let correction = Read(run, "correction.json")
            let patch = Path.Combine(run, "correction-" + Check.Text(correction["uuid"]), "candidate.patch")
            Reconstruct(flow, run, patch, tree, "corrected-replay")
            Check.That(Check.Text(correction["tree"]) == tree, "Correction bound another binary tree")
            flow.Git("-C", checkout, "config", "diff.renames", "false")
            Check.That(
                flow.Git(
                    "-C",
                    checkout,
                    "diff",
                    "--binary",
                    "--full-index",
                    "--find-renames=100%",
                    Check.Text(Read(run)["base"]),
                    commit
                ) +
                    "\n" == File.ReadAllText(patch),
                "Corrected binary evidence depends on rename configuration"
            )
            flow.Call([]string{"verify", "owner/project#10"}, owner: true)
            Once(flow, 1)
        }

        private func FirstVerification(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.VerificationPolicy("test -f result.txt", second: "printf second-original-check")
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("verification_fail")
            flow.Call([]string{"work", "--run", run}, 1)
            let originalRun = File.ReadAllText(Path.Combine(run, "run.json"))
            let original = File.ReadAllText(Path.Combine(run, "candidate.patch"))
            let failed = File.ReadAllText(Path.Combine(run, "verification.json"))
            Prepared(flow, run)
            let checkout = Path.Combine(run, "checkout")
            let bad = Correct(flow, run, "")
            File.Delete(Path.Combine(checkout, "result.txt"))
            let failing = Commit(flow, run, "Still fails")
            let rejected = Check.Envelope(
                ReworkAndSubmit(flow, run, failing, 1, json: true),
                "amend",
                "error",
                "verification_failed"
            )
            Check.That(
                Check.Text(
                    rejected["error"]?["message"]
                ) == "Independent verification failed. Inspect the private verification artifact.",
                "JSON correction lost the owner verification reason"
            )
            Check.That(
                Check.Text(rejected["data"]?["run_state"]?["correction"]?["state"]) == "failed",
                "JSON correction lost failed attempt"
            )
            let attempt = Read(run, "correction.json")
            Check.That(
                attempt["verification"]?.AsArray().Count == 2,
                "Correction skipped an original owner command after failure"
            )
            Check.Contains(Check.Text(attempt["verification"]?[1]?["output"]), "second-original-check")
            let savedAttempt = File.ReadAllText(Path.Combine(run, "correction.json"))
            ReworkAndSubmit(flow, run, failing, 1)
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == savedAttempt,
                "Failed correction retried implicitly"
            )
            let commit = Correct(flow, run)
            Check.That(commit != bad && commit != failing, "New attempt lacks a new explicit commit")
            let published = Check.Envelope(ReworkAndSubmit(flow, run, commit, json: true), "amend", "ok")
            Check.That(
                Check.Text(published["data"]?["commit"]) == commit && Check.Text(
                    published["data"]?["correction"]?["commit"]
                ) == commit,
                "JSON correction lost exact head"
            )
            Once(flow, 1)
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/run.json")) == originalRun,
                "JSON correction changed original"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/candidate.patch")) == original,
                "Original saved candidate replaced"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/verification.json")) == failed,
                "Original failed checks replaced"
            )
            Check.That(Directory.GetDirectories(run, "correction-*").Length == 2, "Failed attempt evidence lost")
        }

        private func OriginalTimeout(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.VerificationPolicy(
                "printf synthetic-verifier-prefix; printf synthetic-verifier-error >&2; sleep 12 && test -f result.txt"
            )
            flow.Approve()
            let run = flow.Claim("10")
            Check.Contains(flow.Call([]string{"work", "--run", run}, 1).Error, "Runtime limit reached")
            let interrupted = Read(run, "verification.json")[0]
            Check.That(interrupted?["exit_code"] == nil, "Timeout fabricated a completed check")
            Check.Contains(Check.Text(interrupted?["output"]), "synthetic-verifier-prefix")
            Check.Contains(Check.Text(interrupted?["error"]), "synthetic-verifier-error")
            Check.That(Check.Text(interrupted?["state"]) == "interrupted", "Interrupted phase was lost")
            let originalChecks = File.ReadAllText(Path.Combine(run, "verification.json"))
            let original = File.ReadAllText(Path.Combine(run, "candidate.patch"))
            let checkout = Path.Combine(run, "checkout")
            let tree = flow.Git("-C", checkout, "write-tree")
            Prepared(flow, run)
            let commit = Commit(flow, run)
            Check.That(flow.Git("-C", checkout, "rev-parse", "HEAD^{tree}") == tree, "Commit changed original work")
            Check.That(
                flow.Git("-C", checkout, "diff", "--binary", Check.Text(Read(run)["base"]), commit) + "\n" == original,
                "Commit changed the original candidate patch"
            )
            Rework(flow, run, commit)
            Once(flow)
            Check.That(Check.Text(Read(run, "correction.json")["tree"]) == tree, "Correction verified a different tree")
            for path in[]string{"candidate.patch", "original-evidence/candidate.patch"} {
                Check.That(File.ReadAllText(Path.Combine(run, path)) == original, "Original candidate was replaced")
            }
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/verification.json")) == originalChecks,
                "Interrupted original check evidence replaced"
            )
            Check.That(
                Directory.GetDirectories(Path.Combine(run, "original-evidence"), "verification-*").Length == 1,
                "Original raw verifier prefix was not sealed"
            )
            Check.Contains(Check.Text(Read(run, "original-evidence/run.json")["error"]), "Runtime limit reached")
        }

        private func WrongTarget(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for stage in[]string{"amend", "prepare"} {
                baseline.Restore()
                flow.Reload()
                var commit = ""
                if stage == "amend" {
                    Prepared(flow, run)
                    commit = Correct(flow, run)
                }
                flow.Reload()
                let pulls = JsonArray()
                pulls.Add(
                    Check.Map(
                        "number",
                        9,
                        "state",
                        "open",
                        "draft",
                        true,
                        "base",
                        Check.Map("ref", "other"),
                        "head",
                        Check.Map(
                            "ref",
                            Check.Text(Read(run)["branch"]),
                            "repo",
                            Check.Map("full_name", "donor/project", "owner", Check.Map("login", "donor", "id", 123))
                        )
                    )
                )
                flow.State["pulls"] = pulls
                flow.Save()
                if stage == "prepare" {
                    Check.Contains(flow.Call([]string{"amend", "--run", run}, 1).Error, "physical PR")
                    Check.That(!Directory.Exists(Path.Combine(run, "original-evidence")), "Published work was prepared")
                } else {
                    Check.Contains(ReworkAndSubmit(flow, run, commit, 1).Error, "physical PR")
                    Check.That(
                        !File.Exists(Path.Combine(run, "correction.json")) ||
                            Read(run, "correction.json")["verification"] == nil,
                        "Published work reached checks"
                    )
                }
                Once(flow, 1)
                Check.That(flow.State["pr_create_count"] == nil, "Wrong-target PR caused another PR write")
            }
        }

        private func Tools(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            Prepared(flow, run)
            let commit = Correct(flow, run)
            let path = Path.Combine(flow.Temp.Root, "correction-tools.json")
            File.WriteAllText(
                path,
                "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
            )
            ReworkAndSubmit(flow, run, commit, 1, path)
            File.WriteAllText(
                path,
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"not-allowed\",\"effort\":\"high\"}]"
            )
            ReworkAndSubmit(flow, run, commit, 1, path)
            Once(flow)
        }

        private func Refusals(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Call([]string{"amend", "--run", run}, 1)
            flow.NoInference()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            for key in[]string{"viewer_login", "viewer_id"} {
                flow.Reload()
                flow.State[key] = key == "viewer_login" ? JsonValue.Create("other") as JsonNode: JsonValue.Create(
                    999
                ) as JsonNode
                flow.Save()
                flow.Call([]string{"amend", "--run", run}, 1)
                Check.That(!Directory.Exists(Path.Combine(run, "original-evidence")), "Another donor archived work")
                flow.Reload()
                flow.State.AsObject().Remove(key)
                flow.Save()
            }
            Prepared(flow, run)
            let commit = Correct(flow, run)
            ReworkAndSubmit(flow, run, commit, 1, seconds: "86400")
            ReworkAndSubmit(flow, run, commit, 1, seconds: "0")
            let rejected = Check.Envelope(
                ReworkAndSubmit(flow, run, String('0', 40), 1, json: true),
                "amend",
                "error",
                "invalid_state"
            )
            Check.That(
                Check.Text(
                    rejected["error"]?["message"]
                ) == "Amend requires a clean checkout at the declared exact commit",
                "JSON correction lost the exact checkout reason"
            )
            let current = File.ReadAllText(Path.Combine(run, "correction.json"))
            flow.Reload()
            let issue = flow.State["issue"] ?? throw Exception("Missing issue")
            issue["labels"] = JsonArray()
            flow.Save()
            ReworkAndSubmit(flow, run, commit, 1)
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == current,
                "Revocation changed correction progress"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/run.json")) == original,
                "Refusal rewrote original"
            )
            Once(flow)
        }

        private func Incomplete(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for mode in[]string{"incomplete_turn", "incomplete_tail", "failed_turn", "inference_exit_failure"} {
                baseline.Restore()
                flow.Reload()
                flow.Mode(mode)
                flow.Call([]string{"work", "--run", run}, 1)
                let original = File.ReadAllText(Path.Combine(run, "run.json"))
                Check.Contains(flow.Call([]string{"amend", "--run", run}, 1).Error, "incomplete_turn")
                Check.That(
                    !Directory.Exists(Path.Combine(run, "original-evidence")),
                    "Incomplete turn archived evidence"
                )
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == original,
                    "Incomplete refusal changed run"
                )
                Once(flow)
            }
        }

        private func ProtectedAndExact(binary string) {
            using let protectedFlow = NativeFixture(binary)
            protectedFlow.Initialize()
            protectedFlow.ProtectedPolicy()
            protectedFlow.Approve()
            let protectedRun = protectedFlow.Claim()
            protectedFlow.Mode("staged_whitespace")
            protectedFlow.Call([]string{"work", "--run", protectedRun}, 1)
            let archive = Prepared(protectedFlow, protectedRun)
            let checkout = Path.Combine(protectedRun, "checkout")
            using let baseline = FixtureSnapshot(protectedFlow.Temp.Root)
            for change in[]string{
                "verifier",
                "verifier-rename",
                "--assume-unchanged",
                "--skip-worktree",
                "workflow-move",
                "template-rename"
            } {
                baseline.Restore()
                protectedFlow.Reload()
                switch change {
                    case "verifier" {
                        File.WriteAllText(Path.Combine(checkout, "scripts/verify.sh"), "exit 0\n")
                    }
                    case "verifier-rename" {
                        protectedFlow.Git("-C", checkout, "mv", "scripts/verify.sh", "ordinary-verifier.sh")
                    }
                    case "workflow-move" {
                        Directory.CreateDirectory(Path.Combine(checkout, ".github/workflows"))
                        File.Move(
                            Path.Combine(checkout, "result.txt"),
                            Path.Combine(checkout, ".github/workflows/corrected.yml")
                        )
                        File.WriteAllText(
                            Path.Combine(checkout, ".github/workflows/corrected.yml"),
                            "Corrected renamed content\n"
                        )
                    }
                    case "template-rename" {
                        protectedFlow.Git("-C", checkout, "mv", ".github/tokate-pr.md", "ordinary-template.md")
                    }
                }
                let commit = Correct(protectedFlow, protectedRun)
                if change.StartsWith("--") {
                    protectedFlow.Git("-C", checkout, "update-index", change, "result.txt")
                    File.AppendAllText(Path.Combine(checkout, "result.txt"), "Hidden correction change\n")
                    Check.That(
                        protectedFlow.Git("-C", checkout, "status", "--porcelain") == "",
                        "Index flag must hide change"
                    )
                    let result = ReworkAndSubmit(protectedFlow, protectedRun, commit, 1)
                    Check.Contains(result.Error, "candidate_invalid")
                    Check.Contains(result.Error, "index contains")
                } else {
                    Check.Contains(
                        ReworkAndSubmit(protectedFlow, protectedRun, commit, 1).Error,
                        change.StartsWith("verifier") ? "protected owner path": "protected owner configuration"
                    )
                }
                Check.That(
                    Read(protectedRun, "correction.json")["verification"] == nil,
                    "Refused correction reached verification"
                )
                Check.That(
                    File.ReadAllText(Path.Combine(protectedRun, "original-evidence/manifest.json")) == archive,
                    "Refused correction changed original evidence"
                )
                Once(protectedFlow)
            }
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.VerificationPolicy("test -f result.txt && printf changed >> result.txt")
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            Prepared(flow, run)
            let commit = Correct(flow, run)
            Check.Contains(ReworkAndSubmit(flow, run, commit, 1).Error, "candidate_changed")
            Check.That(
                Check.Text(Read(run, "correction.json")["verification"]?[0]?["exit_code"]) == "0",
                "Expected check to pass before exact-candidate refusal"
            )
            Once(flow)
        }

        private func ManagedRun(flow CoordinationFixture, mode string) string {
            flow.Claim()
            File.WriteAllText(
                flow.Tools,
                "[{\"harness\":\"codex\",\"provider\":\"openai\",\"model\":\"gpt-6.1-sol\",\"effort\":\"high\"}]"
            )
            let run = flow.Prepare("tokate")
            flow.Flow.Mode(mode)
            flow.Flow.Call([]string{"work", "--run", run}, mode == "" ? 0: 1)
            return run
        }

        private func UnpublishedInterruptedVerification(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.VerificationPolicy(
                "mkdir build-output; printf generated > build-output/data; printf completed-first-check",
                second: "test -s build-output/data; printf synthetic-interrupted-check; printf synthetic-interrupted-error >&2; sleep 3 && printf completed-second-check"
            )
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            Prepared(flow, run)
            let commit = Correct(flow, run)
            Check.Contains(Rework(flow, run, commit, 1, seconds: "1").Error, "verification_failed")
            let failed = Read(run, "correction.json")
            Check.That(
                failed["verification"]?.AsArray().Count == 2,
                "Interrupted verification lost prior or active check results"
            )
            Check.That(Check.Text(failed["verification"]?[0]?["exit_code"]) == "0", "Prior completed check lost")
            Check.That(failed["verification"]?[1]?["exit_code"] == nil, "Interrupted check fabricated an exit code")
            Check.Contains(Check.Text(failed["verification"]?[1]?["output"]), "synthetic-interrupted-check")
            Check.Contains(Check.Text(failed["verification"]?[1]?["error"]), "synthetic-interrupted-error")
            Check.Contains(Check.Text(failed["error"]), "Runtime limit")
            Check.That(
                !Directory.Exists(Path.Combine(run, "checkout/build-output")),
                "Interrupted correction build output retained"
            )
            let evidence = File.ReadAllText(Path.Combine(run, "correction.json"))
            Rework(flow, run, commit, 1, seconds: "1")
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == evidence,
                "Interrupted verification retried implicitly"
            )
            let corrected = Correct(flow, run)
            Rework(flow, run, corrected)
            Check.That(Directory.GetDirectories(run, "correction-*").Length == 2, "Interrupted attempt evidence lost")
            Once(flow)
        }

        private func ChangedCandidate(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            Prepared(flow, run)
            let commit = Correct(flow, run)
            let tree = flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD^{tree}")
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for mode in[]string{"change_checked_head", "change_checked_tree", "change_checked_patch"} {
                baseline.Restore()
                flow.Reload()
                flow.Mode(mode)
                Check.Contains(Rework(flow, run, commit, 1).Error, "candidate_changed")
                let correction = Read(run, "correction.json")
                Check.That(
                    Check.Text(correction["commit"]) == commit && Check.Text(correction["tree"]) == tree,
                    "Candidate binding changed during verification"
                )
                Check.That(
                    Check.Text(correction["verification"]?[0]?["exit_code"]) == "0",
                    "Concurrent change did not happen after a passed check"
                )
                Once(flow)
            }
        }

        private func ArchiveTampering(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            let head = flow.Git("-C", Path.Combine(run, "checkout"), "rev-parse", "HEAD")
            Check.Contains(Rework(flow, run, head, 1).Error, "original-evidence")
            Check.That(!File.Exists(Path.Combine(run, "correction.json")), "Missing archive accepted a candidate")
            Prepared(flow, run)
            let commit = Correct(flow, run)
            flow.Mode("push_fail")
            Rework(flow, run, commit, 1)
            flow.Mode("")
            let evidence = File.ReadAllText(Path.Combine(run, "correction.json"))
            let archive = Path.Combine(run, "original-evidence")
            let held = Path.Combine(run, "held-evidence")
            Directory.Move(archive, held)
            Check.Contains(Rework(flow, run, commit, 1).Error, "original-evidence")
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == evidence,
                "Missing archive accepted a candidate"
            )
            Check.That(!Directory.Exists(archive), "Missing archive was silently reconstructed")
            Directory.Move(held, archive)
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let tampered = Read(run)
            tampered["execution_seconds"] = JsonValue.Create(12345)
            File.WriteAllText(Path.Combine(run, "run.json"), tampered.ToJsonString())
            Check.Contains(Rework(flow, run, commit, 1).Error, "execution attribution changed: execution_seconds")
            File.WriteAllText(Path.Combine(run, "run.json"), original)
            let reportPath = Path.Combine(run, "original-evidence/report.md")
            let report = File.ReadAllText(reportPath)
            File.AppendAllText(reportPath, "Archive was changed\n")
            Check.Contains(Rework(flow, run, commit, 1).Error, "archive changed")
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == evidence,
                "Changed archive accepted a candidate"
            )
            File.WriteAllText(reportPath, report)
            Rework(flow, run, commit)
            Once(flow)
        }

        private func AuthorityChanges(binary string) {
            using let flow = NativeFixture(binary)
            flow.Initialize()
            flow.Approve()
            let run = flow.Claim()
            flow.Mode("staged_whitespace")
            flow.Call([]string{"work", "--run", run}, 1)
            let original = Prepared(flow, run)
            let commit = Correct(flow, run)
            using let baseline = FixtureSnapshot(flow.Temp.Root)
            for change in[]string{"approval", "template", "policy", "access", "branch", "fork"} {
                baseline.Restore()
                flow.Reload()
                switch change {
                    case "approval" {
                        flow.Approve()
                    }
                    case "template" {
                        File.AppendAllText(
                            Path.Combine(flow.Upstream, ".github/tokate-pr.md"),
                            "Owner changed template\n"
                        )
                        flow.Commit("Changed template")
                    }
                    case "policy" {
                        let path = Path.Combine(flow.Upstream, ".github/tokate.json")
                        let policy = Check.Json(File.ReadAllText(path))
                        policy["max_seconds"] = JsonValue.Create(3000)
                        File.WriteAllText(path, policy.ToJsonString())
                        flow.Commit("Changed policy")
                    }
                    case "access" {
                        flow.Call([]string{"access", "deny", "donor", "owner/project"}, owner: true)
                    }
                    case "branch" {
                        let fork = Path.Combine(flow.Bin, "fork")
                        let tree = flow.Git("-C", fork, "rev-parse", "main^{tree}")
                        let wrong = flow.Git(
                            "-C",
                            fork,
                            "-c",
                            "user.name=Other",
                            "-c",
                            "user.email=other@example.test",
                            "commit-tree",
                            tree,
                            "-m",
                            "Unrelated branch state"
                        )
                        flow.Git("-C", fork, "update-ref", "refs/heads/" + Check.Text(Read(run)["branch"]), wrong)
                    }
                    case "fork" {
                        flow.Reload()
                        flow.State["missing_fork"] = JsonValue.Create(true)
                        flow.Save()
                    }
                }
                Rework(flow, run, commit, 1)
                Check.That(
                    File.ReadAllText(Path.Combine(run, "original-evidence/manifest.json")) == original,
                    "Authority refusal replaced original archive"
                )
                Once(flow)
            }
        }

        private func ManagedRefusals(flow CoordinationFixture, run string, commit string) {
            let saved = File.ReadAllText(Path.Combine(run, "correction.json"))
            let baselineComment = flow.Comment
            using let baseline = FixtureSnapshot(flow.Flow.Temp.Root)
            for change in[]string{"expiry", "revocation", "identity", "attempt"} {
                baseline.Restore()
                flow.Comment = baselineComment
                flow.Flow.Reload()
                switch change {
                    case "expiry" {
                        flow.Expire()
                    }
                    case "revocation" {
                        flow.Flow.Call([]string{"revoke", "owner/project#1"}, owner: true)
                    }
                    case "identity" {
                        flow.Flow.Reload()
                        flow.Flow.State["viewer_id"] = JsonValue.Create(999)
                        flow.Flow.Save()
                    }
                    case "attempt" {
                        let state = flow.State()["state"] ?? throw Exception("Missing state")
                        (state["reservation"] ?? throw Exception("Missing lease"))["attempt"] = JsonValue.Create(
                            Guid.NewGuid().ToString("D")
                        )
                        flow.RewriteState(state)
                    }
                }
                Rework(flow.Flow, run, commit, 1)
                Check.That(
                    File.ReadAllText(Path.Combine(run, "correction.json")) == saved,
                    "Refused recovery rewrote correction"
                )
                flow.Flow.Call([]string{"submit", "--run", run}, 1)
                flow.Flow.Reload()
                Check.That(flow.Flow.State["request_count"] == nil, "Refused authority posted a publication request")
                Once(flow.Flow)
            }
            baseline.Restore()
            flow.Comment = baselineComment
            flow.Flow.Reload()
        }

        private func Managed(binary string) {
            using let flow = CoordinationFlow(binary)
            flow.Initialize()
            flow.Flow.ProtectedPolicy()
            flow.Flow.Approve()
            let run = ManagedRun(flow, "staged_whitespace")
            let archive = Prepared(flow.Flow, run)
            Check.That(Read(run)["public_summary"] != nil, "Original managed summary is missing")
            let originalTools = Check.Text(Read(run)["tools"])
            let publishedTools = Check.Json(originalTools)
            let publishedTool = publishedTools[0] ?? throw Exception("Missing original tool")
            publishedTool["coding_seconds"] = Read(run)["execution_seconds"]?.DeepClone()
            publishedTool["usage"] = Check.Json("{\"input_tokens\":100,\"output_tokens\":10}")
            let commit = Correct(flow.Flow, run)
            File.WriteAllText(
                flow.Tools,
                "[{\"harness\":\"claude\",\"provider\":\"anthropic\",\"model\":\"claude-sonnet-4-6\",\"effort\":\"unknown\",\"usage\":{\"input_tokens\":7},\"coding_seconds\":2}]"
            )
            Rework(flow.Flow, run, commit, tools: flow.Tools)
            Once(flow.Flow)
            Check.That(Read(run)["public_summary"] == nil, "Recovery without a summary retained the original summary")
            Check.That(Read(run)["summary_patch_sha256"] == nil, "Recovery retained the original summary patch binding")
            Check.That(Read(run)["publication_uuid"] == nil, "Recovery posted a v2 publication")
            Check.That(Check.Text(Read(run)["tools"]) == originalTools, "Correction replaced original source/tools")
            let results = Check.Text(Read(run, "correction.json")["verification"])
            Rework(flow.Flow, run, commit, tools: flow.Tools)
            Check.That(
                Check.Text(Read(run, "correction.json")["verification"]) == results,
                "Repeated v2 correction reran checks"
            )
            flow.Flow.Call([]string{"submit", "--run", run})
            let request = Read(run, "request.json")
            Check.That(Check.Text(request["metadata"]?["source"]) == "tokate", "Correction replaced v2 source")
            Check.That(
                JsonNode.DeepEquals(request["metadata"]?["tools"], publishedTools),
                "Publication changed original execution attribution"
            )
            Check.That(Check.Text(request["metadata"]?["correction"]?["head"]) == commit, "v2 correction head lost")
            Check.That(
                JsonNode.DeepEquals(
                    request["metadata"]?["correction"]?["tools"],
                    Check.Json(File.ReadAllText(flow.Tools))
                ),
                "Publication changed correction tools"
            )
            flow.Flow.Call([]string{"submit", "--run", run})
            flow.Flow.Reload()
            Check.That(
                Check.Text(flow.Flow.State["request_count"]) == "1",
                "Repeated submit posted a duplicate request"
            )
            flow.Flow.Reload()
            let posted = Check.PostedRequest(flow.Flow.State)
            let path = flow.Event(posted)
            flow.Coordinate(path)
            flow.Coordinate(path)
            flow.Lifecycle("renew")
            flow.Flow.Call([]string{"submit", "--run", run})
            flow.Flow.Call([]string{"submit", "--run", run})
            Once(flow.Flow, 1)
            Check.That(Check.Text(Read(run)["state"]) == "published", "v2 exact outcome not adopted")
            Check.That(
                Check.Text(Read(run)["state_sha"]) == Check.Text(Read(run, "original-evidence/run.json")["state_sha"]),
                "Submit silently rewrote reservation revision"
            )
            Check.That(
                Check.Text(Read(run, "correction.json")["verification"]) == results,
                "v2 publication replay reran checks"
            )
            flow.Flow.Call([]string{"verify", "owner/project#10"}, owner: true)
            Check.Contains(Check.Text(flow.Flow.State["pulls"]?[0]?["body"]), "Original donor-reported tools")
            Check.Contains(Check.Text(flow.Flow.State["pulls"]?[0]?["body"]), "Donor-reported correction tools")
            Check.That(
                Check.Text(Read(run)["usage"]?["input_tokens"]) == "100",
                "Correction usage replaced original usage"
            )
            Check.Contains(
                Rework(flow.Flow, run, commit, 1, flow.Tools).Error,
                "no file changes compared with the published commit"
            )
            AmendCorrected(flow.Flow, run, archive, flow)
            flow.Expire()
            flow.Flow.Call([]string{"submit", "--run", run}, 1)
            Once(flow.Flow, 1)
        }

        private func PublicationResponses(flow CoordinationFixture, run string) {
            let results = Check.Text(Read(run)["verification"])
            let before = File.ReadAllText(Path.Combine(run, "run.json"))
            using let response = FixtureSnapshot(flow.Flow.Temp.Root)
            for fault in[]string{"issue", "repo", "author", "body", "id"} {
                response.Restore()
                flow.Flow.Reload()
                flow.Flow.State["request_response_fault"] = JsonValue.Create(fault)
                flow.Flow.State["request_response_missing"] = JsonValue.Create(true)
                flow.Flow.Save()
                Check.Contains(flow.Flow.Call([]string{"submit", "--run", run}, 1).Error, "Uncertain request write")
            }
            let request = File.ReadAllText(Path.Combine(run, "request.json"))
            Check.Envelope(
                flow.Flow.Call([]string{"submit", "--run", run, "--json"}, 1),
                "submit",
                "error",
                "invalid_state"
            )
            Check.That(Check.Text(Read(run)["state"]) == "generated", "Inconsistent response published a run")
            Check.That(
                Check.Text(Read(run, "correction.json")["publication"]?["stage"]) == "request_pending",
                "Inconsistent successful POST was recorded as requested"
            )
            flow.Flow.Reload()
            flow.Flow.State["request_response_fault"] = nil
            flow.Flow.State["request_response_missing"] = nil
            flow.Flow.Save()
            flow.Flow.Call([]string{"submit", "--run", run}, 1)
            flow.Flow.Reload()
            let comment = flow.Flow.State["request_comments"]?[0] ?? throw Exception("Missing posted comment")
            (flow.Flow.State["comments"] ?? throw Exception("Missing comments"))[
                Check.Text(comment["id"])
            ] = comment.DeepClone()
            flow.Flow.Save()
            flow.Flow.Call([]string{"submit", "--run", run})
            flow.Flow.Reload()
            Check.That(Check.Text(flow.Flow.State["request_count"]) == "1", "Response recovery duplicated POST")
            Check.That(Check.Text(Read(run)["verification"]) == results, "Response recovery reran verification")
            Check.That(
                File.ReadAllText(Path.Combine(run, "request.json")) == request,
                "Response recovery changed request"
            )
            let original = Check.Json(before)
            for field in[]string{"source", "tools", "correction", "commit", "state_sha"} {
                Check.That(
                    Check.Text(Read(run)[field]) == Check.Text(original[field]),
                    "Response recovery changed " + field
                )
            }
            Once(flow.Flow)
        }

        private func PublicationOutcomes(flow CoordinationFixture, run string) {
            flow.Flow.Reload()
            flow.Coordinate(flow.Event(Check.PostedRequest(flow.Flow.State)))
            using let baseline = FixtureSnapshot(flow.Flow.Temp.Root)
            for fault in[]string{"duplicate", "binding", "outcome"} {
                baseline.Restore()
                flow.Flow.Reload()
                let state = flow.State()["state"] ?? throw Exception("Missing published state")
                let outcomes = state["outcomes"]?.AsArray() ?? throw Exception("Missing outcomes")
                let uuid = Check.Text(Read(run, "correction.json")["publication_uuid"])
                var recorded JsonNode? = nil
                for row in outcomes {
                    if Check.Text(row["uuid"]) == uuid {
                        recorded = row
                    }
                }
                let result = recorded ?? throw Exception("Missing publication outcome")
                switch fault {
                    case "duplicate" {
                        outcomes.Add(result.DeepClone())
                    }
                    case "binding" {
                        result["binding"] = JsonValue.Create("changed-binding")
                    }
                    case "outcome" {
                        result["outcome"] = Check.Map("status", "rejected")
                    }
                }
                let original = File.ReadAllText(Path.Combine(run, "run.json"))
                let checks = Check.Text(Read(run, "correction.json")["verification"])
                flow.Flow.Reload()
                flow.Flow.State["coordination_state_override"] = JsonValue.Create(state.ToJsonString())
                flow.Flow.Save()
                flow.Flow.Call([]string{"submit", "--run", run}, 1)
                Check.That(
                    File.ReadAllText(Path.Combine(run, "run.json")) == original,
                    "Changed recorded outcome published a run"
                )
                flow.Flow.Reload()
                flow.Flow.State["coordination_state_override"] = nil
                flow.Flow.Save()
                flow.Flow.Call([]string{"submit", "--run", run})
                Check.That(Check.Text(Read(run)["state"]) == "published", "Exact recorded outcome was not recovered")
                Check.That(
                    Check.Text(Read(run, "correction.json")["verification"]) == checks,
                    "Outcome recovery reran checks"
                )
                flow.Flow.Reload()
                Check.That(Check.Text(flow.Flow.State["request_count"]) == "1", "Outcome recovery repeated request")
                Once(flow.Flow, 1)
            }
        }

        private func InterruptedManaged(binary string) {
            using let flow = CoordinationFixture(binary)
            flow.Initialize()
            let run = ManagedRun(flow, "staged_whitespace")
            Prepared(flow.Flow, run)
            let commit = Correct(flow.Flow, run)
            let baselineComment = flow.Comment
            using let baseline = FixtureSnapshot(flow.Flow.Temp.Root)
            for mode in[]string{"push_fail_after_write", "request_fail_before_write"} {
                baseline.Restore()
                flow.Comment = baselineComment
                flow.Flow.Reload()
                flow.Flow.Mode(mode)
                Rework(flow.Flow, run, commit, 1)
                let intent = Check.Text(Read(run, "correction.json")["publication"]?["request"])
                let checks = Check.Text(Read(run, "correction.json")["verification"])
                flow.Flow.Mode("")
                flow.Flow.Call([]string{"submit", "--run", run}, mode == "request_fail_before_write" ? 1: 0)
                flow.Flow.Reload()
                Check.That(
                    Check.Text(flow.Flow.State["request_count"]) == (mode == "request_fail_before_write" ? "": "1"),
                    "Interrupted submit duplicated a request"
                )
                Check.That(
                    Check.Text(Read(run, "correction.json")["publication"]?["request"]) == intent,
                    "Submit changed saved UUID/revision/metadata"
                )
                Check.That(Check.Text(Read(run, "correction.json")["verification"]) == checks, "Submit reran checks")
                Once(flow.Flow)
                if mode != "request_fail_before_write" {
                    let posted = Check.PostedRequest(flow.Flow.State)
                    let path = flow.Event(posted)
                    flow.Flow.Mode("lost_state_response")
                    flow.Coordinate(path, 1)
                    flow.Flow.Call([]string{"submit", "--run", run})
                    flow.Coordinate(path)
                    Once(flow.Flow, 1)
                }
            }
            baseline.Restore()
            flow.Comment = baselineComment
            flow.Flow.Reload()
            flow.Flow.Mode("push_fail")
            Rework(flow.Flow, run, commit, 1)
            flow.Flow.Mode("")
            ManagedRefusals(flow, run, commit)
            PublicationResponses(flow, run)
            PublicationOutcomes(flow, run)
            using let external = CoordinationFixture(binary)
            external.Initialize()
            external.Claim()
            let externalRun = external.Prepare()
            Check.Contains(external.Flow.Call([]string{"amend", "--run", externalRun}, 1).Error, "external")
            external.Flow.NoInference()
        }

        private func AmendCorrected(
            flow NativeFixture,
            run string,
            archive string,
            coordinator CoordinationFixture? = nil
        ) {
            let correction = Read(run)["correction"]?.DeepClone()
            let corrected = Check.Text(Read(run)["commit"])
            for text in[]string{"First amendment\n", "Second amendment\n"} {
                let commit = Correct(flow, run, text)
                let args = []string{"amend", "--run", run, "--commit", commit, "--time", "30s"}
                flow.Call(args)
                if let managed = coordinator {
                    flow.Reload()
                    let request = Check.PostedRequest(flow.State)
                    managed.Coordinate(managed.Event(request))
                    flow.Call(args)
                }
                flow.Call([]string{"verify", "owner/project#10"})
                flow.Reload()
                let pull = flow.State["pulls"]?[0] ?? throw Exception("Missing corrected PR")
                let body = Check.Text(pull["body"])
                let prefix = "<!-- tokate-receipt:"
                let start = body.IndexOf(prefix) + prefix.Length
                let receiptText = body.Substring(start, body.IndexOf(" -->", start) - start)
                let receipt = Check.Json(receiptText)
                Check.That(
                    JsonNode.DeepEquals(receipt["correction"], correction),
                    "Amendment changed correction provenance"
                )
                Check.That(Check.Text(receipt["correction"]?["head"]) == corrected, "Historical corrected head lost")
                Check.That(Check.Text(receipt["head"]) == commit, "Receipt lost current amended head")
                Check.That(
                    File.ReadAllText(Path.Combine(run, "original-evidence/manifest.json")) == archive,
                    "Amendment changed original correction archive"
                )
                let provenance = receipt["correction"] ?? throw Exception("Missing correction provenance")
                provenance["head"] = JsonValue.Create(commit)
                pull["body"] = JsonValue.Create(body.Replace(receiptText, receipt.ToJsonString()))
                flow.Save()
                flow.Call([]string{"verify", "owner/project#10"}, 1)
                pull["body"] = JsonValue.Create(body)
                flow.Save()
            }
            let previous = Check.Text(Read(run)["commit"])
            File.WriteAllText(Path.Combine(run, "checkout/scripts/verify.sh"), "exit 0\n")
            let protectedCommit = Correct(flow, run)
            Check.Contains(
                flow.Call([]string{"amend", "--run", run, "--commit", protectedCommit, "--time", "30s"}, 1).Error,
                "protected owner path"
            )
            Check.That(
                !Directory.Exists(Path.Combine(run, "amendments", protectedCommit)),
                "Protected amendment reached verification"
            )
            flow.Reload()
            Check.That(
                Check.Text(flow.State["pulls"]?[0]?["head"]?["sha"]) == previous,
                "Protected amendment published"
            )
            if let managed = coordinator {
                let state = managed.State()
                let metadata = Read(run)
                flow.Git(
                    "-C",
                    Path.Combine(run, "checkout"),
                    "push",
                    Path.Combine(flow.Bin, "fork"),
                    protectedCommit + ":refs/heads/" + Check.Text(metadata["branch"])
                )
                let request = Check.Map(
                    "uuid",
                    Guid.NewGuid().ToString("D"),
                    "expected",
                    Check.Text(state["sha"]),
                    "approval",
                    Check.Text(metadata["approval"]),
                    "action",
                    "amend",
                    "metadata",
                    Check.Map(
                        "fork",
                        Check.Text(metadata["head_repo"]),
                        "branch",
                        Check.Text(metadata["branch"]),
                        "previous",
                        previous,
                        "head",
                        protectedCommit,
                        "pr",
                        10,
                        "seconds",
                        30,
                        "tools",
                        Check.Json("[]"),
                        "verification",
                        "donor-reported-pass",
                        "attempt",
                        Check.Text(metadata["attempt"])
                    )
                )
                Check.Contains(managed.Coordinate(managed.Event(request), 1).Error, "protected owner path")
                Check.That(
                    Check.Text(managed.State()["sha"]) == Check.Text(state["sha"]),
                    "Protected coordinator amendment gained authority"
                )
            }
            Once(flow, 1)
        }

        private func DecreeEdits(binary string) {
            using let test = DecreeFlow(binary, 2)
            test.Initialize()
            test.Text("Approved owner instructions\n")
            test.Flow.Approve()
            let run = test.Start()
            test.Flow.Mode("staged_whitespace")
            test.Flow.Call([]string{"work", "--run", run}, 1)
            let archive = Prepared(test.Flow, run)
            let original = File.ReadAllText(Path.Combine(run, "run.json"))
            let decree = Path.Combine(run, "checkout/DECREE.md")
            File.WriteAllText(decree, "Corrected instruction edit\n")
            var commit = Correct(test.Flow, run)
            Check.Contains(Rework(test.Flow, run, commit, 1).Error, "approved root DECREE.md")
            let refused = Read(run, "correction.json")
            Check.That(refused["verification"] == nil, "Protected correction reached verification")
            Check.That(
                Check.Text(refused["failure_stage"]) == "candidate_validation",
                "Protected correction passed candidate validation"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "run.json")) == original,
                "Refused correction rewrote original run"
            )
            test.Flow.NoPr()
            File.WriteAllText(decree, "Approved owner instructions\n")
            commit = Correct(test.Flow, run)
            Rework(test.Flow, run, commit)
            let coordinator = test.Coordination
            test.Flow.Call([]string{"submit", "--run", run})
            test.Flow.Reload()
            let request = Check.PostedRequest(test.Flow.State)
            coordinator.Coordinate(coordinator.Event(request))
            test.Flow.Call([]string{"submit", "--run", run})
            let saved = File.ReadAllText(Path.Combine(run, "run.json"))
            let correction = File.ReadAllText(Path.Combine(run, "correction.json"))
            let previous = Check.Text(Read(run)["commit"])
            File.WriteAllText(decree, "Amended instruction edit\n")
            commit = Correct(test.Flow, run, "Amendment with instruction edit\n")
            let args = []string{"amend", "--run", run, "--commit", commit, "--time", "30s"}
            Check.Contains(test.Flow.Call(args, 1).Error, "approved root DECREE.md")
            Check.That(
                !Directory.Exists(Path.Combine(run, "amendments", commit)),
                "Protected amendment reached verification"
            )
            Check.That(File.ReadAllText(Path.Combine(run, "run.json")) == saved, "Refused amendment rewrote saved run")
            Check.That(
                File.ReadAllText(Path.Combine(run, "correction.json")) == correction,
                "Refused amendment changed correction evidence"
            )
            test.Flow.Reload()
            Check.That(
                Check.Text(test.Flow.State["pulls"]?[0]?["head"]?["sha"]) == previous,
                "Protected amendment published"
            )
            Check.That(
                File.ReadAllText(Path.Combine(run, "original-evidence/manifest.json")) == archive,
                "Instruction edit changed original archive"
            )
            Once(test.Flow, 1)
        }

        internal func All(binary string, only string = "", partition int32 = 0) {
            var matched bool
            var index int32
            for test in[]TestCase[string]{
                TestCase[string]("DecreeEdits", async (value string) -> DecreeEdits(value)),
                TestCase[string]("Whitespace", async (value string) -> Whitespace(value)),
                TestCase[string]("BinaryRename", async (value string) -> BinaryRename(value)),
                TestCase[string]("FirstVerification", async (value string) -> FirstVerification(value)),
                TestCase[string]("OriginalTimeout", async (value string) -> OriginalTimeout(value)),
                TestCase[string]("WrongTarget", async (value string) -> WrongTarget(value)),
                TestCase[string]("Tools", async (value string) -> Tools(value)),
                TestCase[string]("Refusals", async (value string) -> Refusals(value)),
                TestCase[string]("Incomplete", async (value string) -> Incomplete(value)),
                TestCase[string]("ProtectedAndExact", async (value string) -> ProtectedAndExact(value)),
                TestCase[string]("Managed", async (value string) -> Managed(value)),
                TestCase[string]("InterruptedManaged", async (value string) -> InterruptedManaged(value)),
                TestCase[string]("ChangedCandidate", async (value string) -> ChangedCandidate(value)),
                TestCase[string]("ArchiveTampering", async (value string) -> ArchiveTampering(value)),
                TestCase[string]("AuthorityChanges", async (value string) -> AuthorityChanges(value)),
                TestCase[string](
                    "UnpublishedInterruptedVerification",
                    async (value string) -> UnpublishedInterruptedVerification(value)
                ),
                TestCase[string]("ArchiveIntegrity", async (value string) -> ArchiveIntegrity(value)),
                TestCase[string]("ReceiptAuthority", async (value string) -> ReceiptAuthority(value)),
                TestCase[string]("ForkIdentity", async (value string) -> ForkIdentity(value)),
                TestCase[string]("Rejections", async (value string) -> Rejections(value)),
                TestCase[string]("InterruptedVerification", async (value string) -> InterruptedVerification(value)),
                TestCase[string]("V2", async (value string) -> V2(value)),
                TestCase[string](
                    "V2Recovery",
                    async (value string) -> V2(value, "recovery", native: true, modelPolicy: "unrestricted")
                ),
                TestCase[string]("V2Stale", async (value string) -> V2Stale(value))
            } {
                index++
                if (partition == 1 && index > 16) || (partition == 2 && index <= 16) {
                    continue
                }
                let name = test.Name
                if only != "" && only != name {
                    continue
                }
                matched = true
                if !CiShard.Include("Amendment/" + name) {
                    continue
                }
                test.Run(binary)
                Console.WriteLine("PASS amend " + name)
            }
            Check.That(matched, "Unknown amend selector: " + only)
        }
    }
}
