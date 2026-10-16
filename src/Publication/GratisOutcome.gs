package Tokate

import System
import System.IO
import System.Text.RegularExpressions

internal class GratisOutcome {
    shared {
        private func Artifact(checkout string, name string) string {
            let path = Path.Combine(checkout, name)

            if !File.Exists(path) && FileInfo(path).LinkTarget == nil {
                return ""
            }

            let tracked = Commands.Git(checkout, "ls-files", "--", name)
            let file = FileInfo(path)
            Publication.Require(
                file.LinkTarget == nil && file.Length <= 4096 && tracked == "",
                "Invalid gratis artifact"
            )

            let text = File.ReadAllText(path).Trim()
            Publication.Require(text != "", "Gratis artifact is empty")

            File.Delete(path)

            return text
        }

        internal func Collect(directory string, checkout string, run Data, budget RuntimeBudget) bool {
            let refusal = Artifact(checkout, "tokate-refusal.txt")

            if refusal != "" {
                run.Transition("refused")
                run.Fields["refusal"] = refusal
            } else {
                let home = Environment.GetEnvironmentVariable("HOME") ?? ""
                let title = Artifact(checkout, "tokate-title.txt")

                if title != "" {
                    Publication.Require(
                        Regex.IsMatch(title, "^[\\x20-\\x7E]{1,100}\\z") && !Regex.IsMatch(
                            title,
                            PublicSummary.RestrictedTextPattern
                        ) &&
                            !title.Contains(checkout, StringComparison.Ordinal) && !title.Contains(
                            directory,
                            StringComparison.Ordinal
                        ) &&
                            (home == "" || !title.Contains(home, StringComparison.Ordinal)),
                        "Invalid gratis title"
                    )
                    run.Fields["gratis_title"] = title
                }

                let guidance = J.Get(J.Get(run.Element(), "gratis_context"), "guidance").EnumerateObject().MoveNext()
                run.Fields["ready"] = Artifact(checkout, "tokate-ready.txt") != "" && guidance
                let findings = Artifact(checkout, "tokate-findings.md")

                if findings != "" {
                    File.WriteAllText(Path.Combine(directory, "findings.md"), findings)

                    let safe = !Regex.IsMatch(findings, PublicSummary.RestrictedTextPattern) && !findings.Contains(
                        checkout,
                        StringComparison.Ordinal
                    ) &&
                        !findings.Contains(directory, StringComparison.Ordinal) &&
                        (home == "" || !findings.Contains(home, StringComparison.Ordinal))

                    if guidance && safe {
                        run.Fields["findings"] = findings
                    } else {
                        run.Fields["discussion_error"] = "Findings were not published"
                    }
                }

                PublicSummary.Capture(directory, checkout, run)

                if budget.Git(checkout, "status", "--porcelain") != "" {
                    return false
                }

                run.Transition("skipped")
            }

            run.Fields.Remove("failure_stage")
            run.Fields.Remove("failure_reason")

            run.Save(directory)

            return true
        }
    }
}
