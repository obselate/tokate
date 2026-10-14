package Tokate

import System
import System.Collections.Generic
import System.ComponentModel
import System.IO
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class CliOption(name string, value string, description string, choices string = "") {
    internal let Name string = name
    internal let Value string = value
    internal let Description string = description
    internal let Choices string = choices

    internal func Describe(command string) string -> switch Name {
        case "yes" when command == "doctor": "Confirm the listed missing-package and harness installations; no inference"
        case "yes" when command == "coordinator-setup": "Apply the reviewed configuration files and matching Actions allowlist; no inference"
        case "yes" when command == "work": "Confirm inference, every repository task within the selected limits, or stopping after the current task"
        case "yes" when command == "approve": "Confirm ending an existing reservation or published PR authority"
        case "non-interactive" when command == "init": "Never prompt; settings missing from the GitHub policy must be given explicitly"
        case "non-interactive" when command == "approve": "Never prompt; supply ISSUE or --title explicitly"
        case "non-interactive" when command == "coordinator-setup": "Never prompt; supply missing choices explicitly; preview unless --yes is given"
        case "path" when command == "init": "Checkout of the repository to write into; default: current directory"
        case "time" when command == "external": "Separate verification budget, at most the owner limit; required only for correction"
        case "tools" when command == "external": "Complete cumulative donor-reported tools JSON; retain prior rows, required only for correction"
        case "commit" when command == "external": "Exact commit; default: HEAD of the saved run coding checkout"
        case "commit" when command == "amend": "Exact commit; default: HEAD of the saved run checkout"
        case "time" when command == "work": "Total budget for coding and verification per task; default: the lower of 1h and the owner limit"
        case "time" when command == "claim": "Total budget for coding and verification such as 30m or 2h, at most 24h"
        case "time" when command == "amend": "Separate verification budget; required for a new amendment, at most the owner limit"
        case "resume" when command == "amend": "Use the current same-donor reservation for this new amendment; retain the original execution identity"
        default: Description.Replace("{{time}}", "the lower of 1h and the owner limit")
    }
}

internal class CliCommand(
    name string,
    options string,
    required string,
    summary string,
    usage string,
    example string,
    effects string = "local_read",
    target string = "",
    group string = ""
) {
    internal let Name string = name
    internal let Options string = options
    internal let Required string = required
    internal let Summary string = summary
    internal let Usage string = usage
    internal let Example string = example
    internal let Effects string = effects
    internal let Target string = target
    internal let Group string = group

    internal func Has(name string) bool -> ("," + Options + ",help,traffic,json,plain,ascii,").Contains(
        "," + name + ","
    )

    internal func Needs(name string) bool -> ("," + Required + ",").Contains("," + name + ",")

    internal prop SupportsSavedRun bool -> Name == "work" || Name == "checks" || Name == "prepare" || Name == "status"

    internal prop Brief string -> Summary.Split([]string{". ", "; "}, StringSplitOptions.None)[0].TrimEnd('.')

    internal prop Runs bool -> Target == "run" || Name == "work" || Name == "checks" || Name == "status"

    internal func ConflictsWithRun(name string) bool -> name != "run" &&
        name != "help" &&
        name != "traffic" &&
        name != "json" &&
        name != "plain" &&
        name != "ascii" &&
        (
        (Name == "work" && name != "yes" && name != "non-interactive") ||
            (Name == "checks" && name != "watch" && name != "timeout" && name != "verbose") ||
            Name == "prepare" ||
            Name == "status"
    )
}

internal class Cli {
    shared {
        internal let Options[]CliOption = []CliOption{
            CliOption(
                "claude",
                "FILE",
                "Installed unmodified native Claude Code executable; never installed implicitly"
            ),
            CliOption(
                "claude-profile",
                "DIR",
                "Existing Claude configuration directory; defaults to your normal Claude profile"
            ),
            CliOption("policy", "FILE", "Repository policy; default: .github/tokate.json in the selected checkout"),
            CliOption(
                "set-default",
                "",
                "Choose an installed harness as the default; name the harness for a noninteractive choice"
            ),
            CliOption("trust", "", "Request trusted donor access instead of access to one issue"),
            CliOption("auth", "", "Explicitly check tool-owned authentication status; never print credential values"),
            CliOption("fix", "", "Offer installation or an existing path for missing prerequisites"),
            CliOption(
                "model-policy",
                "MODE",
                "Explicit model access choice; existing restrictions are preserved",
                "unrestricted whitelist"
            ),
            CliOption(
                "models",
                "JSON",
                "Map of models to effort arrays copied to each selected tool; absent declares no effort control"
            ),
            CliOption(
                "allowed-tools",
                "TOOLS",
                "Tool names keep external and OMP permissions; exact harness/provider pairs or a JSON array with per-tool models replace the list"
            ),
            CliOption("eligibility", "MODE", "Task eligibility; new repositories default to trusted", "trusted open"),
            CliOption("verification", "JSON", "Existing project verification commands as JSON argv arrays"),
            CliOption("required-checks", "JSON", "Required GitHub check names as a JSON array"),
            CliOption("reservation-time", "TIME", "Reservation lifetime from 5m to 7d"),
            CliOption("pr-text", "TEXT", "Optional literal owner text appended to PRs; no template expressions"),
            CliOption("title", "TEXT", "Title of a new issue to create and approve; excludes ISSUE"),
            CliOption("body", "TEXT", "Plain text description of the new issue; excludes --body-file"),
            CliOption("body-file", "FILE", "Read the new issue description from a file; excludes --body"),
            CliOption(
                "close-message",
                "TEXT",
                "Optional literal admission message reserved for later admission integration"
            ),
            CliOption(
                "base-branch",
                "BRANCH",
                "Owner-selected target; default: upstream default branch (prompt on a terminal)"
            ),
            CliOption("total", "TIME", "Start tasks only while --time fits in this total, default: until stopped"),
            CliOption("model", "MODEL", "Owner-approved model"),
            CliOption(
                "effort",
                "EFFORT",
                "Owner-approved effort",
                "off minimal low medium high xhigh max ultra absent"
            ),
            CliOption("harness", "HARNESS", "Managed harness: codex, claude, pi, omp or command"),
            CliOption("harness-path", "FILE", "Existing harness executable at an absolute custom path"),
            CliOption("endpoint", "URL", "Private pi no-auth loopback Chat Completions base URL"),
            CliOption("pi-root", "DIR", "Donor-installed pi node_modules directory; no installation"),
            CliOption("node", "FILE", "Donor-installed Node executable for pi"),
            CliOption(
                "provider",
                "PROVIDER",
                "Managed provider: openai, anthropic, local-chat-completions or an OMP provider name"
            ),
            CliOption(
                "availability",
                "STATUS",
                "Donor report for the candidate model; never an account probe",
                "unknown available unavailable"
            ),
            CliOption("non-interactive", "", "Never prompt; require an eligible default or explicit choice"),
            CliOption("yes", "", "Confirm inference with the selected pair; never accept a substitute"),
            CliOption(
                "incomplete",
                "",
                "Publish stopped work as an incomplete draft without claiming verification passed"
            ),
            CliOption("time", "TIME", "Verification budget such as 90s, 5m or 1h; default: {{time}}"),
            CliOption("max-time", "TIME", "Longest budget a donor can choose, at most 24h"),
            CliOption(
                "unlimited",
                "",
                "No coding time limit when owner permits; requires --verify-time and excludes --time"
            ),
            CliOption(
                "verify-time",
                "TIME",
                "Verification time; required with --unlimited, otherwise reserved within --time; default: none"
            ),
            CliOption("fork", "LOGIN/REPO", "Explicit donor fork; otherwise discover one or create it once"),
            CliOption(
                "runs",
                "DIR",
                "Run storage; default: tokate/runs under XDG_STATE_HOME, or ~/.local/state/tokate/runs"
            ),
            CliOption("run", "DIR", "Exact saved run directory"),
            CliOption("from-pr", "N", "Seed a donation from another donor's last coordinated PR commit"),
            CliOption(
                "continue-from",
                "DIR",
                "Import stopped unpublished same-donor managed work into a fresh active attempt"
            ),
            CliOption("path", "DIR", "Repository directory; default: current directory"),
            CliOption("watch", "", "Wait for checks; default: off"),
            CliOption("verbose", "", "Show check evidence and required owner actions"),
            CliOption("timeout", "TIME", "Check wait limit, at most 24h; default: 20m"),
            CliOption("state", "SHA", "Exact coordination-state commit"),
            CliOption("source", "SOURCE", "Coding source", "external tokate"),
            CliOption("tools", "FILE", "Nonsecret JSON tool declarations"),
            CliOption("summary", "FILE", "Bounded public JSON summary for the exact candidate commit"),
            CliOption("file", "FILE", "Strict claim or publication request JSON"),
            CliOption("event", "FILE", "Trusted GitHub event JSON"),
            CliOption("output", "FILE", "New workflow file outside .github"),
            CliOption("sync", "SHA", "Exact live owner synchronization grant"),
            CliOption(
                "resume",
                "",
                "Inspect saved reconciliation intent and physical Git state without repeating a merge"
            ),
            CliOption("grant", "SHA", "Synchronization grant to revoke"),
            CliOption("upstream", "SHA", "Exact current trusted target revision"),
            CliOption("commit", "SHA", "Exact candidate commit to verify"),
            CliOption("help", "", "Show help (-h); no tools, network or inference"),
            CliOption("prompt", "URL|FILE", "Gratis task instruction from a bounded file or HTTPS URL"),
            CliOption("traffic", "", "Print Tokate API counts on stderr; default: off"),
            CliOption("json", "", "Emit one schema-version-1 result on stdout; diagnostics on stderr"),
            CliOption("plain", "", "Plain human output without color, ornament or animation; --json takes precedence"),
            CliOption("ascii", "", "Use ASCII ornaments; preserve names and URLs verbatim"),
        }

        internal let Commands[]CliCommand = []CliCommand{
            CliCommand(
                "work",
                "harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive,yes,time,verify-time,total,prompt,unlimited,fork,runs,run,continue-from",
                "repo",
                "Code an approved issue with your harness and verify it. With a repository, donate until stopped. Repositories without a Tokate policy use gratis mode.",
                "[ISSUE [NAME] | RUN | OWNER/REPO] [--time PER_TASK] [--total TOTAL] [--prompt URL|FILE] [options]\n       tokate work OWNER/REPO stop [--yes]",
                "work 42 --model MODEL --effort high",
                effects: "local_read local_write github_read github_write inference",
                target: "issue",
                group: "donate"
            ),
            CliCommand(
                "claim",
                "source,tools,harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive,time,verify-time,unlimited,fork,runs,continue-from,from-pr",
                "repo,issue",
                "Reserve an approved issue and save a claim; name an issue, not only a repository. No inference or PR publication.",
                "ISSUE [NAME] [--model MODEL --effort EFFORT] [options]\n       [--source external --tools FILE --time TIME]",
                "claim 42 --model gpt-6.1-sol --effort high",
                effects: "local_read local_write github_read github_write",
                target: "issue",
                group: "donate"
            ),
            CliCommand(
                "submit",
                "run,incomplete",
                "run",
                "Push saved work and request a draft PR; no inference.",
                "RUN [--incomplete]",
                "submit 42",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "donate"
            ),
            CliCommand(
                "status",
                "run",
                "repo",
                "Show issue state and who acts next, or a saved run offline; no writes or inference.",
                "[ISSUE | OWNER/REPO | RUN]",
                "status 42",
                effects: "local_read github_read",
                target: "issue",
                group: "donate"
            ),
            CliCommand(
                "checks",
                "run,watch,timeout,verbose",
                "repo,pr",
                "Read PR receipt, report, CI and freshness gates; a saved run also stores results locally. Exit: 0 machine gates passed, 8 pending, 1 failed. Owners retain acceptance and merge.",
                "PR | RUN [--watch] [--timeout TIME] [--verbose]",
                "checks 10 --watch",
                effects: "local_read local_write github_read",
                target: "pr",
                group: "donate"
            ),
            CliCommand(
                "runs",
                "",
                "",
                "List saved runs on this computer; offline, no writes or inference.",
                "[ISSUE | OWNER/REPO]",
                "runs 42",
                effects: "local_read",
                target: "issue",
                group: "donate"
            ),
            CliCommand(
                "pause",
                "run",
                "run",
                "Pause your reservation of saved work; no inference.",
                "RUN",
                "pause 42",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "donate"
            ),
            CliCommand(
                "resume",
                "run",
                "run",
                "Resume your paused reservation; no inference.",
                "RUN",
                "resume 42",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "donate"
            ),
            CliCommand(
                "renew",
                "run",
                "run",
                "Renew your reservation before it expires; no inference.",
                "RUN",
                "renew 42",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "donate"
            ),
            CliCommand(
                "release",
                "run",
                "run",
                "Release your reservation for other donors; no inference.",
                "RUN",
                "release 42",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "donate"
            ),
            CliCommand(
                "init",
                "path,model-policy,models,allowed-tools,eligibility,verification,required-checks,base-branch,max-time,reservation-time,pr-text,close-message,non-interactive",
                "repo",
                "Write owner policy and a pinned workflow into a checkout; starts from the policy on GitHub and options change only what they name.",
                "[OWNER/REPO] [--path DIR] [options]",
                "init owner/project",
                effects: "local_read local_write github_read",
                target: "repo",
                group: "own"
            ),
            CliCommand(
                "approve",
                "base-branch,yes,title,body,body-file,non-interactive",
                "repo",
                "Create or approve an issue for donors with a GitHub record and label; no donor assignment.",
                "[ISSUE | --title TEXT [--body TEXT | --body-file FILE]] [--base-branch BRANCH] [--non-interactive] [--yes]",
                "approve 42",
                effects: "local_read github_read github_write",
                target: "issue",
                group: "own"
            ),
            CliCommand(
                "revoke",
                "",
                "repo,issue",
                "Remove GitHub approval; blocks publication, not active computation.",
                "ISSUE",
                "revoke 42",
                effects: "local_read github_read github_write",
                target: "issue",
                group: "own"
            ),
            CliCommand(
                "access",
                "trust",
                "repo",
                "Request or manage donor access; inspect pending requests and history; no scoring.",
                "[list|history] [LOGIN] [OWNER/REPO]\n       tokate access init [OWNER/REPO]\n       tokate access trust|untrust|deny|restore LOGIN [OWNER/REPO]\n       tokate access grant|remove LOGIN ISSUE\n       tokate access check ISSUE\n       tokate access request ISSUE [--trust]",
                "access trust donor",
                effects: "local_read github_read github_write",
                target: "access",
                group: "own"
            ),
            CliCommand(
                "verify",
                "",
                "repo,pr",
                "Check a PR receipt against owner approval; no inference or publication.",
                "PR",
                "verify 10",
                effects: "local_read github_read",
                target: "pr",
                group: "own"
            ),
            CliCommand(
                "policy",
                "",
                "repo",
                "Read upstream owner policy from GitHub; no inference.",
                "[OWNER/REPO]",
                "policy owner/project",
                effects: "local_read github_read",
                target: "repo",
                group: "own"
            ),
            CliCommand(
                "doctor",
                "repo,auth,harness-path,pi-root,node,claude-profile,fix,yes,set-default",
                "",
                "Check prerequisites or owner repository health; repository checks are read-only; no inference.",
                "[owner [OWNER/REPO] | managed [HARNESS] | external | HARNESS] [--auth] [--fix [--yes]] [--set-default]",
                "doctor",
                effects: "local_read local_write github_read",
                target: "doctor",
                group: "setup"
            ),
            CliCommand(
                "defaults",
                "harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile",
                "",
                "Save or choose harness and model profiles; no inference.",
                "set [NAME] --harness HARNESS [options]\n       tokate defaults use NAME\n       tokate defaults show|remove [NAME]\n       tokate defaults",
                "defaults set --model gpt-6.1-sol --effort high",
                effects: "local_read local_write",
                target: "defaults",
                group: "setup"
            ),
            CliCommand(
                "update",
                "",
                "",
                "Download and install latest stable Tokate; no inference.",
                "",
                "update",
                effects: "local_read local_write github_read",
                target: "",
                group: "setup"
            ),
            CliCommand(
                "uninstall",
                "",
                "",
                "Remove managed installation offline; keep saved runs.",
                "",
                "uninstall",
                effects: "local_read local_write",
                target: "",
                group: "more"
            ),
            CliCommand(
                "select",
                "harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive",
                "repo",
                "Select under current owner policy and offline harness capabilities; no inference or reservation.",
                "[OWNER/REPO] [NAME] [--model MODEL --effort EFFORT] [options]\n       tokate select NAME [options]",
                "select owner/project NAME --non-interactive",
                effects: "local_read local_write github_read",
                target: "repo",
                group: "more"
            ),
            CliCommand(
                "overlaps",
                "",
                "repo,prs",
                "Read selected contribution filename overlap and native issue dependencies; advisory only.",
                "PR PR... | OWNER/REPO#PR OWNER/REPO#PR...",
                "overlaps owner/project#12 owner/project#34",
                effects: "local_read github_read",
                target: "prs",
                group: "more"
            ),
            CliCommand(
                "recover-request",
                "",
                "repo,issue",
                "Owner: process the latest unprocessed request with the installed coordinator and current login.",
                "ISSUE",
                "recover-request 42",
                effects: "local_read github_read github_write",
                target: "issue",
                group: "more"
            ),
            CliCommand(
                "amend",
                "run,commit,time,tools,sync,summary,resume",
                "run",
                "Archive completed work, or verify and publish a same-donor correction before or after publication; no inference.",
                "RUN\n       tokate amend RUN --time TIME [--commit SHA] [--tools FILE] [--summary FILE] [--sync GRANT] [--resume]",
                "amend 42 --time 5m",
                effects: "local_read local_write github_read github_write",
                target: "run",
                group: "more"
            ),
            CliCommand(
                "external",
                "run,commit,summary,time,tools",
                "run",
                "Fetch and verify an exact external commit in isolation; no inference or publication.",
                "RUN [--commit SHA] [--summary FILE]\n       tokate external RUN --time TIME --tools FILE [--commit NEW]",
                "external 42",
                effects: "local_read local_write github_read",
                target: "run",
                group: "more"
            ),
            CliCommand(
                "reconcile",
                "run,resume",
                "run",
                "Merge the exact current target in a saved published workspace; no inference, checks or publication.",
                "RUN [--resume]",
                "reconcile 42",
                effects: "local_read local_write github_read",
                target: "run",
                group: "more"
            ),
            CliCommand(
                "authorize-sync",
                "commit,upstream,sync",
                "repo,pr,commit,upstream",
                "Owner: grant an exact candidate synchronization; no candidate inspection or acceptance.",
                "PR --commit SHA --upstream SHA [--sync PREVIOUS_GRANT]",
                "authorize-sync 10 --commit C --upstream U",
                effects: "local_read github_read github_write",
                target: "pr",
                group: "more"
            ),
            CliCommand(
                "revoke-sync",
                "grant",
                "repo,grant",
                "Owner: preserve and revoke a synchronization grant by nonforce ref advance.",
                "[OWNER/REPO] --grant SHA",
                "revoke-sync --grant G",
                effects: "local_read github_read github_write",
                target: "repo",
                group: "more"
            ),
            CliCommand(
                "coordinator-setup",
                "output,non-interactive,yes",
                "repo,output",
                "Preview a shared workflow entry using verified matching release assets; no inference.",
                "[OWNER/REPO] --output FILE",
                "coordinator-setup owner/project --output coordinator.yml",
                effects: "local_read local_write github_read github_write",
                target: "repo",
                group: "more"
            ),
            CliCommand(
                "completion",
                "",
                "",
                "Print Bash, Zsh or Fish completion locally; no tool checks or inference.",
                "bash|zsh|fish",
                "completion bash",
                effects: "local_read",
                target: "subject",
                group: "more"
            ),
            CliCommand(
                "help",
                "",
                "",
                "Show global or focused command help locally.",
                "[COMMAND]",
                "help work",
                effects: "local_read",
                target: "subject",
                group: "more"
            ),
            CliCommand(
                "--version",
                "",
                "",
                "Print installed version locally.",
                "",
                "--version",
                effects: "local_read",
                target: "",
                group: "more"
            ),
            CliCommand(
                "coordination",
                "",
                "repo,issue",
                "Read authoritative v2 issue state from GitHub; no inference or publication.",
                "ISSUE",
                "coordination 42",
                effects: "local_read github_read",
                target: "issue",
                group: "internal"
            ),
            CliCommand(
                "request",
                "file",
                "repo,issue,file",
                "Post a strict claim or publication request; no inference.",
                "ISSUE --file FILE",
                "request 42 --file request.json",
                effects: "local_read local_write github_read github_write",
                target: "issue",
                group: "internal"
            ),
            CliCommand(
                "prepare",
                "run,state,source,tools,harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive,fork,time,verify-time,unlimited,runs,continue-from,from-pr,yes",
                "repo,issue,state,source",
                "Prepare a fresh reserved v2 contribution, or resume recorded preparation; no inference, checks or publication.",
                "ISSUE [NAME] --state SHA --source external --tools FILE [options]\n       tokate prepare ISSUE [NAME] --state SHA --source tokate [selection options]\n       [--continue-from DIR --time TIME --verify-time TIME --yes]\n       tokate prepare --run DIR",
                "prepare 42 --state SHA --source external --tools tools.json",
                effects: "local_read local_write github_read github_write",
                target: "issue",
                group: "internal"
            ),
            CliCommand(
                "admit",
                "event",
                "repo,event",
                "Trusted owner workflow: close PRs without current owner authorization; no inference.",
                "[OWNER/REPO] --event FILE",
                "admit owner/project --event event.json",
                effects: "local_read github_read github_write",
                target: "repo",
                group: "internal"
            ),
            CliCommand(
                "coordinate",
                "event",
                "repo,event",
                "Trusted owner workflow: update v2 state and publish approved requests; no inference.",
                "[OWNER/REPO] --event FILE",
                "coordinate owner/project --event event.json",
                effects: "local_read github_read github_write",
                target: "repo",
                group: "internal"
            ),
            CliCommand(
                "claude-capabilities",
                "claude,claude-profile,model,effort,file,path,policy",
                "claude,model,effort",
                "Check installed native Claude interfaces and personal login status without inference.",
                "--claude FILE --model MODEL --effort EFFORT [--claude-profile DIR] [--policy FILE] [--file REPORT]",
                "claude-capabilities --claude /usr/local/bin/claude --model MODEL --effort EFFORT",
                effects: "local_read local_write",
                target: "",
                group: "internal"
            ),
        }

        internal func Find(name string) CliCommand {
            for command in Commands {
                if command.Name == name {
                    return command
                }
            }

            if name == "verify-pr" {
                throw Exception("Unknown command: verify-pr. Use tokate verify.")
            }

            var nearest = ""
            var distance int32 = 3

            for command in Commands {
                if command.Group != "internal" && Distance(name, command.Name) < distance {
                    distance = Distance(name, command.Name)
                    nearest = command.Name
                }
            }

            throw Exception(
                "Unknown command: " +
                    name +
                    (nearest == "" ? ".": ". Did you mean " + nearest + "?") +
                    " Run tokate --help"
            )
        }

        private func Distance(a string, b string) int32 {
            let row = [b.Length + 1]int32
            var j int32 = 0

            while j <= b.Length {
                row[j] = j
                j++
            }

            var i int32 = 1

            while i <= a.Length {
                var previous = row[0]

                row[0] = i
                j = 1

                while j <= b.Length {
                    let current = row[j]

                    row[j] = Math.Min(Math.Min(row[j], row[j - 1]) + 1, previous + (a[i - 1] == b[j - 1]? 0: 1))
                    previous = current
                    j++
                }

                i++
            }

            return row[b.Length]
        }

        internal func Words(command string) string -> command == "work" ? "stop":
        command == "defaults" ? "set show remove list use":
        command == "access" ? String.Join(" ", Positionals.AccessOperations):
        command == "doctor" ? "owner managed external codex claude pi omp":
        command == "completion" ? "bash zsh fish": ""

        internal func RepositoryWork(args Args) bool -> args.Command == "work" && args.Get("issue") == "" && args.Get(
            "run"
        ) == ""

        internal func OptionFor(command string, name string) CliOption {
            for option in Options {
                if option.Name == name && Find(command).Has(name) {
                    return option
                }
            }

            throw Exception("Unknown option for " + command + ": --" + name)
        }

        internal func Global(word string) bool -> word == "--json" ||
            word == "--plain" ||
            word == "--ascii" ||
            word == "--traffic"

        internal func TimeKey(name string) string -> name == "time" || name == "max-time" ? "seconds":
        name == "verify-time" ? "verification-reserve": name == "reservation-time" ? "reservation-seconds": name

        internal func Seconds(value string, name string) string {
            let match = Regex.Match(value, "^([0-9]{1,7})([smhd])\\z")
            let unit = match.Groups[2].Value
            let seconds = !match.Success ? 0: Int64.Parse(match.Groups[1].Value) *
            (unit == "s" ? 1: unit == "m" ? 60: unit == "h" ? 3600: 86400)

            if seconds < 1 || seconds > Int32.MaxValue {
                throw Exception("Use a time such as 90s, 30m or 2h: --" + name)
            }

            return seconds.ToString()
        }

        internal func Label(key string) string -> switch key {
            case "issue": "ISSUE"
            case "pr": "PR"
            case "prs": "PR PR..."
            case "donor": "LOGIN"
            case "operation": "OPERATION"
            case "run": "RUN"
            case "attempt": "RUN"
            case "repo": "OWNER/REPO"
            case "profile": "NAME"
            case "seconds": "--time"
            case "verification-reserve": "--verify-time"
            case "reservation-seconds": "--reservation-time"
            default: "--" + key
        }

        internal func Positional(command CliCommand)[]string -> switch command.Name {
            case "work": []string{"ISSUE|OWNER/REPO|RUN", "NAME|stop"}

            case "claim": []string{"ISSUE", "NAME"}

            case "prepare": []string{"ISSUE", "NAME"}

            case "status": []string{"ISSUE|OWNER/REPO|RUN"}

            case "checks": []string{"PR|RUN"}

            case "runs": []string{"ISSUE|OWNER/REPO"}

            case "select": []string{"OWNER/REPO|NAME", "NAME"}

            case "doctor": []string{
                "owner|managed|external|HARNESS",
                "OWNER/REPO (after owner) or HARNESS (after managed)"
            }
            default: switch command.Target {
                case "issue": []string{"ISSUE"}

                case "pr": []string{"PR"}

                case "prs": []string{"PR|OWNER/REPO#PR", "PR..."}

                case "repo": []string{"OWNER/REPO"}

                case "run": []string{"RUN"}

                case "access": []string{"OPERATION", "LOGIN", "OWNER/REPO|ISSUE"}

                case "defaults": []string{"list|set|show|remove|use", "NAME"}

                case "subject": []string{command.Name == "help" ? "COMMAND": "bash|zsh|fish"}
                default: []string{}
            }
        }

        internal func Usage(name string) string {
            let command = Find(name)
            return "Usage: tokate " + name + (command.Usage == "" ? "": " " + command.Usage)
        }

        internal func Metadata(name string = "") Object {
            let commands = List[Object]()

            for command in Commands {
                if name != "" && command.Name != name {
                    continue
                }

                let options = List[Object]()

                for option in Options {
                    if command.Has(option.Name) && !Global("--" + option.Name) && option.Name != "help" {
                        options.Add(
                            map[string, Object?]{
                                "name": "--" + option.Name,
                                "value": option.Value,
                                "description": option.Describe(command.Name),
                                "choices": option.Choices == "" ? []string{}: option.Choices.Split(' ')
                            }
                        )
                    }
                }

                let inputs = List[Object]()
                let conflicts = List[Object]()

                for option in command.Options.Split(',', StringSplitOptions.RemoveEmptyEntries) {
                    if command.ConflictsWithRun(option) {
                        conflicts.Add(option)
                    }
                }

                inputs.Add(command.Required == "" ? []string{}: command.Required.Split(','))

                if command.SupportsSavedRun {
                    inputs.Add([]string{"run"})
                }

                let effects = map[string, Object?]{}
                let declaredEffects = command.Effects.Split(' ')

                for effect in[]string{"local_read", "local_write", "github_read", "github_write"} {
                    effects[effect] = Array.IndexOf(declaredEffects, effect) >= 0
                }

                let modes = List[Object]()

                if command.Name == "defaults" {
                    for mode in[]string{"set", "show", "remove", "list", "use"} {
                        modes.Add(
                            map[string, Object?]{
                                "name": mode,
                                "required_inputs": mode == "use" ? []string{"NAME"}: []string{},
                                "required_input_sets": mode == "set" ? [][]string{
                                    []string{"harness"},
                                    []string{"model", "effort"}
                                }: [][]string{},
                                "effects": map[string, Object?]{
                                    "local_read": true,
                                    "local_write": mode == "set" || mode == "remove" || mode == "use",
                                    "github_read": false,
                                    "github_write": false
                                }
                            }
                        )
                    }
                }

                if command.Name == "access" {
                    for mode in Positionals.AccessOperations {
                        let write = mode != "list" && mode != "history" && mode != "check"
                        modes.Add(
                            map[string, Object?]{
                                "name": mode,
                                "required_inputs": mode == "grant" || mode == "remove" ? []string{"LOGIN", "ISSUE"}:
                                mode == "check" || mode == "request" ? []string{"ISSUE"}:
                                mode == "init" || !write ? []string{}: []string{"LOGIN"},
                                "effects": map[string, Object?]{
                                    "local_read": true,
                                    "local_write": false,
                                    "github_read": true,
                                    "github_write": write
                                }
                            }
                        )
                    }
                }

                if command.Name == "status" {
                    for mode in[]string{"repository", "run"} {
                        modes.Add(
                            map[string, Object?]{
                                "name": mode,
                                "required_inputs": []string{mode == "run" ? "run": "repo"},
                                "effects": map[string, Object?]{
                                    "local_read": true,
                                    "local_write": false,
                                    "github_read": mode == "repository",
                                    "github_write": false
                                }
                            }
                        )
                    }
                }

                commands.Add(
                    map[string, Object?]{
                        "command": command.Name,
                        "summary": command.Summary,
                        "arguments": options,
                        "positional_arguments": Positional(command),
                        "operations": modes,
                        "required_inputs": inputs,
                        "repository_inputs": command.Target == "issue" ||
                            command.Target == "pr" ||
                            command.Target == "prs" ||
                            command.Target == "repo" ||
                            command.Target == "access" ? (
                            command.Target == "issue" ? (
                                command.Name == "status" ||
                                    command.Name == "runs" ||
                                    command.Name == "work" ||
                                    command.Name == "claim" ? []string{
                                    "repo",
                                    "repository_argument",
                                    "issue_reference",
                                    "issue_url",
                                    "local_github_remote"
                                }: []string{"repo", "issue_reference", "issue_url", "local_github_remote"}
                            ):
                            command.Target == "access" ? []string{
                                "repo",
                                "repository_argument",
                                "issue_reference",
                                "issue_url",
                                "local_github_remote"
                            }:
                            command.Target == "pr" ||
                                command.Target == "prs" ? []string{
                                "repo",
                                "pr_reference",
                                "pr_url",
                                "local_github_remote"
                            }:
                            []string{"repo", "repository_argument", "local_github_remote"}
                        ): []string{},
                        "exclusive_run_inputs": conflicts,
                        "effects": effects,
                        "inference": command.Effects.Contains("inference"),
                        "noninteractive": true
                    }
                )
            }

            let shared = List[Object]()

            for option in Options {
                if Global("--" + option.Name) || option.Name == "help" {
                    shared.Add(map[string, Object?]{"name": "--" + option.Name, "description": option.Describe("")})
                }
            }

            return map[string, Object?]{
                "version": ApplicationInfo.Version(),
                "subject": name,
                "global_arguments": shared,
                "commands": commands
            }
        }

        internal func Name(args[]string) string {
            for word in args {
                if !Global(word) {
                    return word == "--help" || word == "-h" ? "help": word == "version" ? "--version": word
                }
            }

            return "help"
        }

        internal func ErrorUsage(args[]string) string {
            var name = Name(args)
            let index = Array.IndexOf(args, name)

            if name == "help" && index >= 0 && index + 1 < args.Length && !args[index + 1].StartsWith("-") {
                name = args[index + 1]
            }

            for command in Commands {
                if command.Name == name {
                    return Usage(name) + "\nRun tokate " + name + " --help for options."
                }
            }

            return "Usage: tokate <command> [options]\nRun tokate --help for commands."
        }

        private func OptionHelp(text StringBuilder, label string, description string, width int32) {
            text.AppendLine("  " + label)

            var line = "    "
            for word in description.Split(' ', StringSplitOptions.RemoveEmptyEntries) {
                if line.Length > 4 && line.Length + word.Length + 1 > width - 2 {
                    text.AppendLine(line)
                    line = "    "
                }

                line += (line.Length == 4 ? "": " ") + word
            }

            text.AppendLine(line)
            text.AppendLine()
        }

        internal func Help(name string = "", width int32 = 80) string {
            let text = StringBuilder()

            if name == "" {
                text.AppendLine("Tokate " + ApplicationInfo.Version() + " (toh-KAH-teh)")
                text.AppendLine("Donate AI usage to approved GitHub issues.\n\nUsage: tokate <command> [options]\n")
                text.AppendLine("Run tokate for guided setup, donations and saved work.\n")

                let more = List[string]()

                for group in[]string{"donate", "own", "setup"} {
                    text.AppendLine(
                        group == "donate" ? "Donate": group == "own" ? "\nOwn a project": "\nSet up this computer"
                    )

                    for command in Commands {
                        if command.Group != group {
                            continue
                        }

                        if width < 80 {
                            OptionHelp(text, command.Name, command.Brief, width)
                        } else {
                            text.AppendLine("  " + command.Name.PadRight(10) + command.Brief)
                        }
                    }
                }

                for command in Commands {
                    if command.Group == "more" {
                        more.Add(command.Name)
                    }
                }

                text.AppendLine("\nMore commands: " + String.Join(", ", more) + ".")
                text.AppendLine("\nUse tokate <command> --help, tokate help <command>, or -h for details.")
                text.AppendLine("In a checkout, 42 names issue or PR 42 of its GitHub remote.")
                text.AppendLine("Elsewhere use OWNER/REPO#42 or a GitHub URL. PRs are drafts; owners review and merge.")
                text.AppendLine(
                    "Human output: --plain or --ascii. NO_COLOR and TERM=dumb select plain text in terminals."
                )
            } else {
                let command = Find(name)

                text.AppendLine(Usage(name))
                text.AppendLine(command.Summary + "\n")

                let issue = "Issue 42 of the local GitHub remote, OWNER/REPO#42 or an issue URL"
                if command.Target == "issue" {
                    OptionHelp(
                        text,
                        (
                            name == "status" || name == "runs" || name == "work" ? "ISSUE|OWNER/REPO":
                            "ISSUE"
                        ) +
                            (command.Needs("issue") ? " (required)": ""),
                        issue,
                        width
                    )
                } else if command.Target == "pr" {
                    OptionHelp(
                        text,
                        "PR (required)",
                        "PR 10 of the local GitHub remote, OWNER/REPO#10 or a PR URL",
                        width
                    )
                } else if command.Target == "prs" {
                    OptionHelp(
                        text,
                        "PR PR... (required)",
                        "2 to 16 unique PR numbers; outside a checkout qualify each as OWNER/REPO#N",
                        width
                    )
                } else if command.Target == "repo" {
                    OptionHelp(
                        text,
                        "OWNER/REPO",
                        "Repository or repository URL; default: the local GitHub remote",
                        width
                    )
                } else if command.Target == "access" {
                    OptionHelp(text, "LOGIN", "Donor login; @me uses your signed-in account", width)
                    OptionHelp(text, "ISSUE", issue, width)
                    OptionHelp(
                        text,
                        "OWNER/REPO",
                        "Optional trailing repository when the operation has no issue operand; default: the local GitHub remote",
                        width
                    )
                } else if command.Target == "doctor" {
                    OptionHelp(
                        text,
                        "owner|codex|managed|external|HARNESS",
                        "Choose one scope or one harness such as codex",
                        width
                    )
                }

                if name == "select" {
                    OptionHelp(
                        text,
                        "NAME",
                        "Saved donor profile; in a checkout this can be the only positional",
                        width
                    )
                }

                if name == "work" || name == "claim" || name == "prepare" {
                    OptionHelp(text, "NAME", "Saved donor profile; follows ISSUE.", width)
                }

                if command.Runs {
                    OptionHelp(
                        text,
                        "RUN" + (command.Needs("run") ? " (required)": ""),
                        "Saved run: 42-3 or OWNER/REPO#42-3 names one attempt; tokate runs lists them" +
                            (command.Target == "run" ? "; 42 uses the newest attempt of issue 42": ""),
                        width
                    )
                }

                for option in Options {
                    if !command.Has(option.Name) || option.Name == "traffic" {
                        continue
                    }

                    let required = command.Needs(option.Name) && option.Name != "run" ? " (required)": ""
                    OptionHelp(
                        text,
                        "--" + option.Name + (option.Value == "" ? "": " " + option.Value) + required,
                        option.Describe(name) + (option.Choices == "" ? "": " (" + option.Choices + ")"),
                        width
                    )
                }

                if name == "status" || name == "runs" {
                    text.AppendLine("For repository status or saved runs, use OWNER/REPO or a GitHub repository URL.")
                }

                if name == "work" || name == "claim" {
                    text.AppendLine(
                        name == "work" ? "Bare work uses the local GitHub remote. Repository work uses tool flags or a default profile and one confirmation. Named issues guide missing tool and budget choices. Redirected repository work and --json require --yes.":
                        "Name an issue. Missing tool and budget choices are guided in a terminal. Redirected input and --json never prompt."
                    )
                }

                if command.SupportsSavedRun {
                    text.AppendLine(
                        name == "status" ? "Use RUN or --run DIR alone for offline status without GitHub or harness tools. Repository status is bounded and may report truncation; blocked work and failed CI still exit 0 after a successful read.":
                        name == "prepare" ? "Use --run DIR only for recorded preparation before coding; it never resumes coding.":
                        name == "work" ? "ISSUE alone continues its newest saved claim; otherwise it starts a new attempt. For a saved claim, use RUN or --run DIR instead of required inputs.":
                        "Use RUN or --run DIR instead of PR to check a saved run. A PR with one saved run uses that run."
                    )
                }

                text.AppendLine("\nExample:\n  tokate " + command.Example)
            }

            return text.ToString().TrimEnd()
        }

        internal func PullNumbers(value string) List[int32] {
            let parts = value.Split(',')

            if parts.Length < 2 || parts.Length > 16 {
                throw Exception("overlaps requires 2 to 16 unique positive PR numbers")
            }

            let numbers = List[int32]()
            let seen = HashSet[int32]()

            for part in parts {
                var number int32

                if !Regex.IsMatch(part, "^[0-9]+\\z") || !Int32.TryParse(part, out number) || number < 1 || !seen.Add(
                    number
                ) {
                    throw Exception("overlaps requires 2 to 16 unique positive PR numbers")
                }

                numbers.Add(number)
            }

            return numbers
        }

        internal func Validate(args Args, guided bool = false) {
            let command = Find(args.Command)

            if RepositoryWork(args) && !args.Help {
                if args.Get("repo") == "" {
                    args.Values["--repo"] = RepositoryInput.Local()
                }
                if args.Subject != "stop" && args.Get("harness") + args.Get("model") + args.Get("effort") == "" &&
                    DonorDefaults
                    .Read(allowMissing: true).ValueKind == JsonValueKind.Undefined {
                    throw Exception(
                        "Choose a tool with tokate work OWNER/REPO --harness codex --model MODEL --effort high, or save a default with tokate defaults set NAME --harness codex --model MODEL --effort high, tokate defaults use NAME, then tokate select OWNER/REPO NAME --non-interactive."
                    )
                }
                if !DonorSelection.Interactive(args) && args.Get("yes") != "true" {
                    throw CliFailure("confirmation_required", "Noninteractive repository work requires --yes")
                }
            }
            if args.Command == "claim" && args.Get("issue") == "" && !args.Help {
                throw Exception(
                    "Name an issue: tokate claim OWNER/REPO#NUMBER. tokate status OWNER/REPO lists approved issues."
                )
            }
            if args.Get("prompt") != "" && !RepositoryWork(args) && !args.Help {
                throw Exception("--prompt requires repository work")
            }
            if args.Get("total") != "" && !RepositoryWork(args) && !args.Help {
                throw Exception("--total requires repository work")
            }
            if RepositoryWork(args) && args.Get("unlimited") == "true" && !args.Help {
                throw Exception("Repository work uses --time and --total, not --unlimited")
            }

            if args.Command == "approve" {
                if args.Get("issue") != "" && args.Get("title") + args.Get("body") + args.Get("body-file") != "" {
                    throw Exception("ISSUE excludes --title, --body and --body-file")
                }

                if args.Get("body") != "" && args.Get("body-file") != "" {
                    throw Exception("--body and --body-file are mutually exclusive")
                }

                if !args.Help && args.Get("issue") == "" && !DonorSelection.Interactive(args) {
                    args.Need("title")
                }
            }

            if !args.Help {
                RunReference.Resolve(args)
            }

            if args.Get("from-pr") != "" &&
                !args.Help &&
                (args.Get("continue-from") != "" || args.Number("from-pr") < 1) {
                throw Exception("--from-pr requires a positive PR number and no local continuation")
            }

            if args.Get("unlimited") == "true" {
                if args.Get("seconds") != "" || args.Get("continue-from") != "" ||
                    (args.Command == "prepare" && args.Get("source") != "tokate") {
                    throw Exception("--unlimited requires fresh managed work and excludes --time and --continue-from")
                }

                if !guided && !args.Help {
                    args.Need("verification-reserve")
                }
            }

            if args.Get("continue-from") != "" && !args.Help {
                args.Need("seconds")
                args.Need("verification-reserve")

                if args.Command == "prepare" && args.Get("source") != "tokate" {
                    throw Exception("--continue-from requires --source tokate")
                }
            }

            if args.Command == "doctor" {
                if args.Get("repo") != "" &&
                    (args.Get("owner") != "true" || args.Get("fix") == "true" || args.Get("set-default") == "true") {
                    throw Exception("Repository diagnostics require doctor owner and are read-only")
                }

                if args.Get("set-default") == "true" && args.Get("harness") == "" &&
                    (args.Get("json") == "true" || !DonorSelection.Interactive(args)) {
                    throw Exception("Name the harness when setting a default noninteractively")
                }

                if args.Get("yes") == "true" && args.Get("fix") != "true" {
                    throw Exception("doctor --yes requires --fix")
                }

                var scopes int32

                for key in[]string{"owner", "managed", "external"} {
                    if args.Get(key) == "true" {
                        scopes++
                    }
                }

                if scopes > 1 {
                    throw Exception("Choose one doctor scope: owner, managed or external")
                }

                if args.Get("harness") != "" && args.Get("harness") != "codex" && args.Get("harness") != "pi" &&
                    args.Get("harness") != "claude" && args.Get("harness") != "omp" &&
                    !(
                    args.Get("set-default") == "true" && Array.IndexOf(
                        DonorDefaults.Harnesses,
                        args.Get("harness")
                    ) >= 0
                ) {
                    throw Exception("Managed diagnostics support codex, claude, pi or omp")
                }

                for key in[]string{"harness", "harness-path", "pi-root", "node", "claude-profile"} {
                    if scopes > 0 && args.Get("managed") != "true" && args.Get(key) != "" {
                        throw Exception("Harness options require managed diagnostics")
                    }
                }

                if args.Get("harness") != "pi" && (args.Get("pi-root") != "" || args.Get("node") != "") {
                    throw Exception("Pi runtime options require the pi harness")
                }
            }

            if args.Get("run") != "" && command.Runs && args.Run == "" && args.Words.Count > 0 {
                throw Exception("--run conflicts with a repository or task argument")
            }

            if args.Get("run") != "" && command.SupportsSavedRun {
                for key in args.Values.Keys {
                    if command.ConflictsWithRun(key.Substring(2)) {
                        throw Exception(
                            (args.Run == "" ? "--run": "Saved run " + args.Run) +
                                " conflicts with " +
                                Label(key.Substring(2))
                        )
                    }
                }
            }

            if args.Get("verification-reserve") != "" && args.Command == "prepare" && args.Get("source") != "tokate" {
                throw Exception("--verify-time requires --source tokate")
            }

            if args.Get("prs") != "" {
                PullNumbers(args.Get("prs"))
            }

            for key in[]string{"seconds", "verification-reserve", "timeout", "pr"} {
                if args.Get(key) != "" {
                    args.Number(key)
                }
            }

            for key in[]string{"repo", "fork"} {
                if args.Get(key) != "" {
                    args.Values["--" + key] = RepositoryInput.Repo(args.Get(key))
                }
            }

            for key in[]string{"path", "run", "runs", "file", "tools", "summary", "event", "output", "continue-from"} {
                if args.Get(key) != "" {
                    Path.GetFullPath(args.Get(key))
                }
            }

            for key in[]string{"harness-path", "pi-root", "node"} {
                if args.Get(key) != "" {
                    LocalPaths.RuntimePath(args.Need(key))
                }
            }

            if args.Get("donor") != "" && args.Get("donor") != "@me" {
                RepositoryIdentity.Login(args.Get("donor"))
            }

            if args.Get("base-branch") != "" {
                RepositoryIdentity.Branch(args.Get("base-branch"))
            }

            if args.Get("model") != "" {
                RequestData.ModelIdentifier(args.Get("model"))
            }

            if args.Get("profile") != "" {
                DonorDefaults.Name(args.Get("profile"))
            }

            for key in[]string{"harness", "provider"} {
                if args.Get(key) != "" && !Regex.IsMatch(args.Get(key), "^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$") {
                    throw Exception("Invalid identifier: --" + key)
                }
            }

            for key in[]string{"effort", "source", "availability", "model-policy", "eligibility"} {
                if args.Get(key) != "" && Array.IndexOf(
                    OptionFor(args.Command, key).Choices.Split(' '),
                    args.Get(key)
                ) < 0 {
                    throw Exception("Invalid value for --" + key)
                }
            }

            for key in[]string{"state", "commit", "grant", "upstream", "sync"} {
                if args.Get(key) != "" {
                    RepositoryIdentity.CommitSha(args.Get(key))
                }
            }

            if args.Command == "completion" &&
                args.Subject != "bash" &&
                args.Subject != "zsh" &&
                args.Subject != "fish" &&
                (args.Subject != "" || !args.Help) {
                throw Exception("Required shell: bash, zsh or fish")
            }

            if args.Help {
                return
            }

            if args.Command == "defaults" {
                if args.Subject != "use" &&
                    args.Subject != "set" &&
                    args.Subject != "show" &&
                    args.Subject != "remove" &&
                    args.Subject != "list" {
                    throw Exception("Unknown defaults operation; use set, show, list, use or remove")
                }

                if args.Subject == "list" && args.Get("profile") != "" {
                    throw Exception("defaults list does not take NAME")
                }

                if args.Subject == "use" && args.Get("profile") == "" {
                    throw Exception("Required: NAME")
                }

                let partial = args.Subject == "set" && args.Get("harness") != "" && args.Get("model") == "" && args.Get(
                    "effort"
                ) == ""
                if args.Subject == "set" && !partial {
                    DonorDefaults.NormalizePair(args)
                }

                if args.Subject == "set" && args.Get("harness") != "claude" && (args.Get("claude-profile") != "") {
                    throw Exception("Claude profile options require the claude harness")
                }

                for key in[]string{
                    "harness",
                    "provider",
                    "model",
                    "effort",
                    "endpoint",
                    "pi-root",
                    "node",
                    "harness-path",
                    "claude-profile",
                } {
                    if args.Subject == "set" {
                        if !partial && (key == "harness" || key == "provider" || key == "model" || key == "effort") {
                            args.Need(key)
                        } else if (key == "endpoint" || key == "pi-root" || key == "node") && args.Get(
                            "harness"
                        ) != "pi" &&
                            args.Get(key) != "" {
                            throw Exception("Pi runtime options require the pi harness")
                        }
                    } else if args.Get(key) != "" {
                        throw Exception("defaults " + args.Subject + " does not take --" + key)
                    }
                }
            }

            if (args.Command == "prepare" || args.Command == "claim") && args.Get("source") == "external" {
                args.Need("tools")

                for key in[]string{"verification-reserve", "unlimited", "continue-from"} {
                    if args.Get(key) != "" {
                        throw Exception("External claims exclude " + Label(key))
                    }
                }

                for key in[]string{
                    "profile",
                    "harness",
                    "provider",
                    "model",
                    "effort",
                    "endpoint",
                    "pi-root",
                    "node",
                    "harness-path",
                    "availability"
                } {
                    if args.Get(key) != "" {
                        throw Exception("External declarations use --tools; selection option conflicts: " + Label(key))
                    }
                }

                if args.Command == "prepare" && args.Get("non-interactive") != "" {
                    throw Exception("External declarations use --tools; selection option conflicts: --non-interactive")
                }
            } else if args.Command == "claim" && args.Get("tools") != "" {
                throw Exception("Claim tool declarations require --source external")
            }

            if args.Get("run") != "" && command.SupportsSavedRun {
                return
            }

            if guided && (args.Command == "work" || args.Command == "claim") && args.Get("continue-from") == "" {
                return
            }

            let missing = List[string]()

            for name in command.Required.Split(',', StringSplitOptions.RemoveEmptyEntries) {
                if name != "repo" && args.Get(TimeKey(name)) == "" {
                    missing.Add(Label(TimeKey(name)))
                }
            }

            if missing.Count > 0 {
                throw Exception("Required: " + String.Join(", ", missing))
            }

            if command.Needs("repo") && args.Get("repo") == "" && args.Command != "init" {
                args.Values["--repo"] = RepositoryInput.Local()
            }
        }
    }
}
