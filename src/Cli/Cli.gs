package Tokate

import System
import System.Collections.Generic
import System.ComponentModel
import System.IO
import System.Linq
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class CliOption(spec string) {
    internal let Words[]string = spec.Substring(0, spec.IndexOf(": ")).Split(' ')
    internal let Description string = spec.Substring(spec.IndexOf(": ") + 2)

    internal prop Name string -> Words[0]

    internal prop Value string -> Words.Length > 1 ? Words[1]: ""

    internal prop Choices string -> String.Join(" ", Words.Skip(2))

    internal func Describe(command string) string -> switch Name {
        case "yes" when command == "init": "Apply the listed required GitHub settings and setup PR"
        case "yes" when command == "doctor": "Confirm the listed missing-package and harness installations; no inference"
        case "yes" when command == "work": "Confirm inference, every repository task within the selected limits, or stopping after the current task"
        case "yes" when command == "update": "Install the listed release version"
        case "yes" when command == "uninstall": "Remove the listed files"
        case "yes": "Confirm the change; required without a terminal prompt"
        case "file" when command == "doctor": "Native Claude report to check against the selected model and effort"
        case "non-interactive": "Never prompt; preview changes unless --yes is given"
        case "time" when command == "external": "Separate verification budget, at most the owner limit; required only for correction"
        case "tools" when command == "external": "Complete cumulative donor-reported tools JSON; retain prior rows, required only for correction"
        case "commit" when command == "external": "Exact commit; default: HEAD of the saved run coding checkout"
        case "commit" when command == "amend": "Exact commit; default: HEAD of the saved run checkout"
        case "time" when command == "work": "Total budget for coding and verification per task; required for an issue; repository work default: the lower of 1h and the owner limit"
        case "time" when command == "claim": "Total budget for coding and verification such as 30m or 2h, at most 24h"
        case "time" when command == "amend": "Separate verification budget; required for a new amendment, at most the owner limit"
        case "resume" when command == "amend": "Use the current same-donor reservation for this new amendment; retain the original execution identity"
        default: Description.Replace("{{time}}", "the lower of 1h and the owner limit")
    }
}

internal class CliCommand(header string, usage string, options string, summary string, example string) {
    internal let Head[]string = header.Split(' ')
    internal let Usage string = usage
    internal let Options string = options
    internal let Summary string = summary
    internal let Example string = example

    internal prop Name string -> Head[0]

    internal prop Group string -> Head[1]

    internal prop Effects[]string -> Head[2].Split(',')

    internal prop Required string -> Head.Length > 3 ? Head[3]: ""

    internal prop Forms List[List[string]] -> Usage
        .Split('\n')
        .Select(
        line -> line
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .TakeWhile(word -> !word.TrimStart('[').StartsWith("-") && word != "[options]")
            .ToList()
    )
        .ToList()

    internal prop Lines[]string -> Usage.Split('\n').Select(form -> ("tokate " + Name + " " + form).Trim()).ToArray()

    internal prop Positionals[]string -> Enumerable
        .Range(0, Forms.Max(form -> form.Count))
        .Select(
        index -> String.Join(
            "|",
            Forms.Where(form -> form.Count > index).SelectMany(form -> form[index].Trim('[', ']').Split('|')).Distinct()
        )
    )
        .ToArray()

    internal func Kinds(literal bool) List[string] -> Forms
        .SelectMany(form -> form)
        .SelectMany(slot -> slot.Trim('[', ']').Split('|'))
        .Where(kind -> Cli.Literal(kind) == literal)
        .Distinct()
        .ToList()

    internal func Has(name string) bool -> ("," + Options + ",help,traffic,json,plain,ascii,").Contains(
        "," + name + ","
    )

    internal func Needs(name string) bool -> ("," + Required + ",").Contains("," + name + ",")

    internal prop SupportsSavedRun bool -> Name == "work" || Name == "claim" || Name == "checks" || Name == "status"

    internal prop Brief string -> Summary.Split([]string{". ", "; "}, StringSplitOptions.None)[0].TrimEnd('.')

    internal prop Runs bool -> Kinds(false).Contains("RUN")

    internal prop RunTarget bool -> Usage.StartsWith("RUN")

    internal func ConflictsWithRun(name string) bool -> name != "run" &&
        name != "help" &&
        name != "traffic" &&
        name != "json" &&
        name != "plain" &&
        name != "ascii" &&
        (
        ((Name == "work" || Name == "claim") && name != "yes" && name != "non-interactive") ||
            (
            Name == "checks" && name != "watch" && name != "timeout" && name != "verbose"
            && name != "yes" && name != "non-interactive"
        ) ||
            Name == "status"
    )
}

internal class Cli {
    shared {
        internal let Options[]CliOption = []string{
            "claude-profile DIR: Existing Claude configuration directory; defaults to your normal Claude profile",
            "policy FILE: Repository policy; default: .github/tokate.json in the selected checkout",
            "set-default: Save the installed harness named with --harness as the default",
            "trust: Request trusted donor access instead of access to one issue",
            "auth: Explicitly check tool-owned authentication status; never print credential values",
            "fix: Preview missing prerequisite installations; --yes applies them; use --harness-path for an existing harness",
            "allowed-tools TOOLS: Tool names, harness/provider pairs or a JSON array with per-tool models; replaces the list; default: codex, claude and pi with any model",
            "eligibility MODE trusted open: Task eligibility; new repositories default to trusted",
            "pin: Pin the coordinator to the exact release commit instead of stable-major v0",
            "verification JSON: Optional project verification commands as JSON argv arrays; default: none",
            "required-checks JSON: Optional GitHub check names as a JSON array; default: none",
            "reservation-time TIME: Reservation lifetime from 5m to 7d",
            "pr-text TEXT: Optional literal owner text appended to PRs; no template expressions",
            "close-message TEXT: Optional literal admission message reserved for later admission integration",
            "base-branch BRANCH: Owner-selected target; default: upstream default branch",
            "total TIME: Start tasks only while --time fits in this total, default: until stopped",
            "model MODEL: Owner-approved model",
            "effort EFFORT off minimal low medium high xhigh max ultra absent: Owner-approved effort",
            "harness HARNESS codex claude pi omp command: Managed harness",
            "harness-path FILE: Existing harness executable at an absolute custom path",
            "endpoint URL: Private pi no-auth loopback Chat Completions base URL",
            "pi-root DIR: Donor-installed pi node_modules directory; no installation",
            "node FILE: Donor-installed Node executable for pi",
            "provider PROVIDER: Managed provider: openai, anthropic, local-chat-completions or an OMP provider name",
            "availability STATUS unknown available unavailable: Donor report for the candidate model; never an account probe",
            "non-interactive: Never prompt; require an eligible default or explicit choice",
            "yes: Confirm inference with the selected pair; never accept a substitute",
            "incomplete: Publish stopped work as an incomplete draft without claiming verification passed",
            "time TIME: Verification budget such as 90s, 5m or 1h; default: {{time}}",
            "max-time TIME: Longest budget a donor can choose, at most 24h",
            "unlimited: No coding time limit when owner permits; requires --verify-time and excludes --time",
            "verify-time TIME: Verification time; required with --unlimited, otherwise reserved within --time; default: none",
            "fork LOGIN/REPO: Explicit donor fork; otherwise discover one or create it once",
            "runs DIR: Run storage; default: tokate/runs under XDG_STATE_HOME, or ~/.local/state/tokate/runs",
            "run DIR: Exact saved run directory",
            "all: Also list finished saved runs",
            "from-pr N: Seed a donation from another donor's last coordinated PR commit",
            "continue-from DIR: Import stopped unpublished same-donor managed work into a fresh active attempt",
            "path DIR: Repository directory; default: current directory",
            "watch: Wait for checks; default: off",
            "verbose: Show check evidence and required owner actions",
            "timeout TIME: Check wait limit, at most 24h; default: 20m",
            "source SOURCE external tokate: Coding source",
            "tools FILE: Nonsecret JSON tool declarations",
            "summary FILE: Bounded public JSON summary for the exact candidate commit",
            "file FILE: Strict claim or publication request JSON",
            "event FILE: Trusted GitHub event JSON",
            "resume: Resume saved amendment publication",
            "commit SHA: Exact candidate commit to verify",
            "help: Show help (-h); no tools, network or inference",
            "prompt URL|FILE: Gratis task instruction from a bounded file or HTTPS URL",
            "review: Gratis work stops each task before publication",
            "traffic: Print Tokate API counts on stderr; default: off",
            "json: Emit one schema-version-1 result on stdout; diagnostics on stderr",
            "plain: Plain human output without color, ornament or animation; --json takes precedence",
            "ascii: Use ASCII ornaments; preserve names and URLs verbatim",
        }
            .Select(spec -> CliOption(spec)).ToArray()

        internal let Positions map[string, string] = map[string, string]{
            "ISSUE": "Issue 42 of the local GitHub remote, OWNER/REPO#42 or an issue URL",
            "PR": "PR 10 of the local GitHub remote, OWNER/REPO#10 or a PR URL",
            "PR...": "2 to 16 unique PR numbers; outside a checkout qualify each as OWNER/REPO#N",
            "RUN": "Saved run: 42, REPO#42 or OWNER/REPO#42; add -3 when the issue has two active attempts",
            "OWNER/REPO": "Repository or repository URL; default: the local GitHub remote",
            "NAME": "Saved donor profile",
            "LOGIN": "Donor login; @me uses your signed-in account",
            "HARNESS": "Managed harness",
            "COMMAND": "Command to describe",
        }

        internal let Operations map[string, string] = map[string, string]{
            "access list": "local_read,github_read",
            "access history": "local_read,github_read",
            "access check": "local_read,github_read",
            "doctor repo": "local_read,github_read",
            "defaults show": "local_read",
            "defaults list": "local_read",
            "defaults set": "local_read,local_write harness model,effort",
            "defaults use": "local_read,local_write",
            "defaults remove": "local_read,local_write",
            "defaults check": "local_read,github_read",
            "work stop": "local_read,local_write",
        }

        internal let Commands[]CliCommand = []CliCommand{
            CliCommand(
                "work donate local_read,local_write,github_read,github_write,inference repo",
                "[ISSUE|OWNER/REPO|RUN] [NAME] [--time PER_TASK] [--total TOTAL] [--prompt URL|FILE] [options]\nOWNER/REPO stop [--yes]",
                "harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive,yes,time,verify-time,total,prompt,review,unlimited,fork,runs,run,continue-from",
                "Code an approved issue with your harness and verify it. Without a Tokate policy, OWNER/REPO lets the harness choose tasks until stopped, OWNER/REPO#N runs one issue, and OWNER/REPO#12,15,40 runs those issues in order. Gratis work publishes each task after start consent. Use --review to stop each task before publication, then tokate submit to preview its exact PR text and --yes to publish. Issue lists and --review require gratis mode. Bare work uses the local GitHub remote. ISSUE alone continues its newest saved claim. Consent asks once in a terminal unless --yes is set. With --json, --non-interactive or no terminal, work and stop preview without changes and require --yes.",
                "work 42 --model MODEL --effort high"
            ),
            CliCommand(
                "claim donate local_read,local_write,github_read,github_write repo,issue",
                "ISSUE [NAME] [--model MODEL --effort EFFORT] [options]\nISSUE --source external --tools FILE --time TIME\nRUN [--yes]",
                "source,tools,harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability,non-interactive,yes,time,verify-time,unlimited,fork,runs,run,continue-from,from-pr",
                "Reserve an approved issue and save a claim; name an issue, not only a repository. With your active reservation, prepare a fresh attempt. RUN finishes a saved claim or its preparation. No inference or PR publication.",
                "claim 42 --model gpt-6.1-sol --effort high"
            ),
            CliCommand(
                "submit donate local_read,local_write,github_read,github_write run",
                "RUN [--incomplete] [--yes]",
                "run,incomplete,yes,non-interactive",
                "Push saved work and request a draft PR; no inference. Gratis work previews the exact PR text and asks once in a terminal. Without a terminal, use --yes to publish.",
                "submit 42"
            ),
            CliCommand(
                "status donate local_read,github_read",
                "[ISSUE|OWNER/REPO|RUN] [--all]",
                "run,all",
                "Show your saved work, repository issues and who acts next, or one issue or saved run; no writes or inference. Bare status lists your saved work, only for this repository inside a checkout. Repository status is bounded and may report truncation. Blocked work and failed CI still exit 0 after a successful read.",
                "status 42"
            ),
            CliCommand(
                "checks donate local_read,local_write,github_read repo,pr",
                "PR|RUN [--watch] [--timeout TIME] [--verbose] [--yes]",
                "run,watch,timeout,verbose,yes,non-interactive",
                "Read PR receipt, report, CI and freshness gates for an open, unmerged PR. A saved run also stores results locally. Exit: 0 machine gates passed, 8 pending, 1 failed, including closed or merged PRs. Owners retain acceptance and merge.",
                "checks 10 --watch"
            ),
            CliCommand(
                "pause donate local_read,local_write,github_read,github_write run",
                "RUN [--yes]",
                "run,yes,non-interactive",
                "Pause your reservation of saved work; no inference.",
                "pause 42"
            ),
            CliCommand(
                "resume donate local_read,local_write,github_read,github_write run",
                "RUN [--yes]",
                "run,yes,non-interactive",
                "Resume your paused reservation; no inference.",
                "resume 42"
            ),
            CliCommand(
                "renew donate local_read,local_write,github_read,github_write run",
                "RUN [--yes]",
                "run,yes,non-interactive",
                "Renew your reservation before it expires; no inference.",
                "renew 42"
            ),
            CliCommand(
                "release donate local_read,local_write,github_read,github_write run",
                "RUN [--yes]",
                "run,yes,non-interactive",
                "Release your reservation for other donors; no inference.",
                "release 42"
            ),
            CliCommand(
                "init own local_read,github_read,github_write repo",
                "[OWNER/REPO] [options]",
                "allowed-tools,eligibility,verification,required-checks,base-branch,max-time,reservation-time,pr-text,close-message,pin,non-interactive,yes",
                "Set up or update a repository: required Actions settings and one setup PR with the policy and coordinator workflow.",
                "init owner/project"
            ),
            CliCommand(
                "approve own local_read,github_read,github_write repo,issue",
                "ISSUE [LOGIN] [--base-branch BRANCH] [--yes]",
                "base-branch,yes,non-interactive",
                "Approve an existing issue with a bound record and label. LOGIN allows one donor without persistent trust. Create issues with gh issue create or the GUI.",
                "approve 42 donor"
            ),
            CliCommand(
                "revoke own local_read,github_read,github_write repo,issue",
                "ISSUE [--yes]",
                "yes,non-interactive",
                "Remove GitHub approval; blocks publication, not active computation.",
                "revoke 42"
            ),
            CliCommand(
                "access own local_read,github_read,github_write repo",
                "[list|history] [LOGIN] [OWNER/REPO]\ninit [OWNER/REPO] [--yes]\ntrust|untrust|deny|restore LOGIN [OWNER/REPO] [--yes]\ncheck ISSUE\nrequest ISSUE [--trust] [--yes]",
                "trust,yes,non-interactive",
                "Request access in a plain comment or manage trusted and denied donors. Owners can use approve ISSUE LOGIN for issue access.",
                "access trust donor"
            ),
            CliCommand(
                "doctor setup local_read,local_write,github_read",
                "[HARNESS] [--auth] [--fix [--yes]] [--set-default]\nHARNESS --model MODEL --effort EFFORT [--policy FILE] [--path DIR] [--file REPORT]\nrepo [OWNER/REPO]\nmanaged [HARNESS]\nexternal",
                "auth,harness,harness-path,pi-root,node,claude-profile,fix,yes,set-default,model,effort,policy,path,file",
                "Check prerequisites, or repository policy and coordinator health; repository checks are read-only; no inference.",
                "doctor"
            ),
            CliCommand(
                "defaults setup local_read,local_write,github_read",
                "set [NAME] --harness HARNESS [options]\nuse NAME\nshow|remove [NAME]\ncheck [OWNER/REPO] [NAME] [--model MODEL --effort EFFORT] [options]\n[list]",
                "harness,provider,model,effort,endpoint,pi-root,node,harness-path,claude-profile,availability",
                "Save or choose harness and model profiles, or check one against owner policy and offline harness capabilities; no inference.",
                "defaults set --model gpt-6.1-sol --effort high"
            ),
            CliCommand(
                "update setup local_read,local_write,github_read",
                "[--yes]",
                "yes,non-interactive",
                "Download and install latest stable Tokate; no inference.",
                "update"
            ),
            CliCommand(
                "uninstall more local_read,local_write",
                "[--yes]",
                "yes,non-interactive",
                "Remove managed installation offline; keep saved runs.",
                "uninstall"
            ),
            CliCommand(
                "overlaps more local_read,github_read repo,prs",
                "PR...",
                "",
                "Read selected contribution filename overlap and native issue dependencies; advisory only.",
                "overlaps owner/project#12 owner/project#34"
            ),
            CliCommand(
                "amend more local_read,local_write,github_read,github_write run",
                "RUN [--yes]\nRUN --time TIME [--commit SHA] [--tools FILE] [--summary FILE] [--resume] [--yes]",
                "run,commit,time,tools,summary,resume,yes,non-interactive",
                "Archive completed work, or verify and publish a same-donor correction before or after publication; no inference.",
                "amend 42 --time 5m"
            ),
            CliCommand(
                "external more local_read,local_write,github_read run",
                "RUN [--commit SHA] [--summary FILE] [--yes]\nRUN --time TIME --tools FILE [--commit NEW] [--yes]",
                "run,commit,summary,time,tools,yes,non-interactive",
                "Fetch and verify an exact external commit in isolation; no inference or publication.",
                "external 42"
            ),
            CliCommand(
                "completion more local_read",
                "bash|zsh|fish",
                "",
                "Print Bash, Zsh or Fish completion locally; no tool checks or inference.",
                "completion bash"
            ),
            CliCommand(
                "help more local_read",
                "[COMMAND]",
                "",
                "Show global or focused command help locally.",
                "help work"
            ),
            CliCommand("--version more local_read", "", "", "Print installed version locally.", "--version"),
            CliCommand(
                "request internal local_read,local_write,github_read,github_write repo,issue,file",
                "ISSUE --file FILE [--yes]",
                "file,yes,non-interactive",
                "Post a strict claim or publication request; no inference.",
                "request 42 --file request.json"
            ),
            CliCommand(
                "admit internal local_read,github_read,github_write repo,event",
                "[OWNER/REPO] --event FILE",
                "event",
                "Trusted owner workflow: close PRs without current owner authorization; no inference.",
                "admit owner/project --event event.json"
            ),
            CliCommand(
                "coordinate internal local_read,github_read,github_write repo,event",
                "[OWNER/REPO] --event FILE",
                "event",
                "Trusted owner workflow: update v2 state and publish approved requests; no inference.",
                "coordinate owner/project --event event.json"
            ),
        }

        internal func Literal(kind string) bool -> Char.IsLower(kind.TrimStart('[')[0])

        internal func Find(name string) CliCommand {
            for command in Commands {
                if command.Name == name {
                    return command
                }
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
            case "prs": "PR..."
            case "donor": "LOGIN"
            case "run": "RUN"
            case "attempt": "RUN"
            case "repo": "OWNER/REPO"
            case "profile": "NAME"
            case "seconds": "--time"
            case "verification-reserve": "--verify-time"
            case "reservation-seconds": "--reservation-time"
            default: "--" + key
        }

        internal func Usage(name string) string -> "Usage: " + String.Join("\n       ", Find(name).Lines)

        private func Effects(declared[]string) Object {
            let effects = map[string, Object?]{}

            for effect in[]string{"local_read", "local_write", "github_read", "github_write"} {
                effects[effect] = declared.Contains(effect)
            }

            return effects
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

                let operations = List[Object]()

                for form in command.Forms {
                    let index = form.FindIndex(Literal)

                    for operation in index < 0 ? []string{}: form[index].Trim('[', ']').Split('|') {
                        var declared string
                        let spec = (
                            Operations.TryGetValue(
                                command.Name + " " + operation,
                                out declared
                            ) ? declared: String.Join(",", command.Effects)
                        ).Split(' ')
                        operations.Add(
                            map[string, Object?]{
                                "name": operation,
                                "required_inputs": form
                                    .Take(index)
                                    .Concat(form.Skip(index + 1))
                                    .Where(slot -> !slot.StartsWith("["))
                                    .ToArray(),
                                "required_input_sets": spec.Skip(1).Select(set -> set.Split(',')).ToArray(),
                                "effects": Effects(spec[0].Split(','))
                            }
                        )
                    }
                }

                let kinds = command.Kinds(false)
                let repository = List[string]()

                if command.Needs("repo") || kinds.Contains("ISSUE") {
                    repository.Add("repo")

                    if kinds.Contains("OWNER/REPO") {
                        repository.Add("repository_argument")
                    }

                    if kinds.Contains("ISSUE") {
                        repository.AddRange([]string{"issue_reference", "issue_url"})
                    }

                    if kinds.Contains("PR") || kinds.Contains("PR...") {
                        repository.AddRange([]string{"pr_reference", "pr_url"})
                    }

                    repository.Add("local_github_remote")
                }

                let inputs = List[Object]()

                inputs.Add(command.Required == "" ? []string{}: command.Required.Split(','))

                if command.SupportsSavedRun {
                    inputs.Add([]string{"run"})
                }

                commands.Add(
                    map[string, Object?]{
                        "command": command.Name,
                        "summary": command.Summary,
                        "usage": command.Lines,
                        "example": "tokate " + command.Example,
                        "arguments": options,
                        "positional_arguments": command.Positionals,
                        "operations": operations,
                        "required_inputs": inputs,
                        "repository_inputs": repository,
                        "exclusive_run_inputs": command.Options.Split(',').Where(command.ConflictsWithRun).ToArray(),
                        "effects": Effects(command.Effects),
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
                text.AppendLine("Run tokate help COMMAND for flags, or use the GUI.\n")

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

                text.AppendLine(
                    "\nMore commands: " + String.Join(
                        ", ",
                        Commands.Where(command -> command.Group == "more").Select(command -> command.Name)
                    ) +
                        "."
                )
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

                for kind in command.Kinds(false) {
                    let required = command.Needs(kind.ToLowerInvariant().Replace("...", "s")) ? " (required)": ""
                    OptionHelp(text, kind + required, Positions[kind], width)
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

        internal func Validate(args Args) {
            let command = Find(args.Command)

            if RepositoryWork(args) && !args.Help {
                if args.Get("repo") == "" {
                    args.Values["--repo"] = RepositoryInput.Local()
                }
                if args.Subject != "stop" && args.Get("harness") + args.Get("model") + args.Get("effort") == "" &&
                    DonorDefaults
                    .Read(allowMissing: true).ValueKind == JsonValueKind.Undefined {
                    throw Exception(
                        "Choose a tool with tokate work OWNER/REPO --harness codex --model MODEL --effort high, or save a default with tokate defaults set NAME --harness codex --model MODEL --effort high, tokate defaults use NAME, then tokate defaults check OWNER/REPO NAME."
                    )
                }
            }
            if args.Command == "claim" && args.Get("issue") == "" && args.Get("run") == "" && !args.Help {
                throw Exception(
                    "Name an issue: tokate claim OWNER/REPO#NUMBER. tokate status OWNER/REPO lists approved issues."
                )
            }
            if args.Get("prompt") != "" && (args.Command != "work" || args.Get("run") != "") && !args.Help {
                throw Exception("--prompt requires repository work")
            }
            if args.Get("total") != "" && (args.Command != "work" || args.Get("run") != "") && !args.Help {
                throw Exception("--total requires repository work")
            }
            if RepositoryWork(args) && args.Get("unlimited") == "true" && !args.Help {
                throw Exception("Repository work uses --time and --total, not --unlimited")
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
                if args.Get("seconds") != "" || args.Get("continue-from") != "" {
                    throw Exception("--unlimited requires fresh managed work and excludes --time and --continue-from")
                }

                if !args.Help {
                    args.Need("verification-reserve")
                }
            }

            if args.Get("continue-from") != "" && !args.Help {
                args.Need("seconds")
            }

            if args.Command == "doctor" {
                if args.Subject == "repo" && (args.Get("fix") == "true" || args.Get("set-default") == "true") {
                    throw Exception("doctor repo is read-only")
                }

                if args.Get("set-default") == "true" && args.Get("harness") == "" {
                    args.Need("harness")
                }

                if args.Get("yes") == "true" && args.Get("fix") != "true" {
                    throw Exception("doctor --yes requires --fix")
                }

                if args.Get("harness") != "" && Harness.Find(args.Get("harness")) == nil {
                    throw Exception("Managed diagnostics support codex, claude, pi or omp")
                }

                for key in[]string{"harness", "harness-path", "pi-root", "node", "claude-profile"} {
                    if args.Subject != "" && args.Subject != "managed" && args.Get(key) != "" {
                        throw Exception("Harness options require managed diagnostics")
                    }
                }

                if !Harness.Owns(args.Get("harness"), "pi-root") &&
                    (args.Get("pi-root") != "" || args.Get("node") != "") {
                    throw Exception("Pi runtime options require the pi harness")
                }

                if args.Subject == "repo" && args.Get("repo") == "" && !args.Help {
                    args.Values["--repo"] = RepositoryInput.Local()
                }

                if args.Get("model") + args.Get("effort") + args.Get("policy") + args.Get("path") + args.Get(
                    "file"
                ) != "" {
                    if args.Get("harness") != "claude" {
                        throw Exception("Model checks require doctor claude")
                    }

                    args.Need("model")
                    args.Need("effort")
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

            for key in[]string{"path", "run", "runs", "file", "tools", "summary", "event", "continue-from"} {
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

            for key in[]string{"effort", "source", "availability", "eligibility"} {
                if args.Get(key) != "" && Array.IndexOf(
                    OptionFor(args.Command, key).Choices.Split(' '),
                    args.Get(key)
                ) < 0 {
                    throw Exception("Invalid value for --" + key)
                }
            }

            for key in[]string{"commit"} {
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
                if args.Subject == "use" && args.Get("profile") == "" {
                    throw Exception("Required: NAME")
                }

                if args.Subject == "check" && args.Get("repo") == "" {
                    args.Values["--repo"] = RepositoryInput.Local()
                }

                let partial = args.Subject == "set" && args.Get("harness") != "" && args.Get("model") == "" && args.Get(
                    "effort"
                ) == ""
                if args.Subject == "set" && !partial {
                    DonorDefaults.NormalizePair(args)
                }

                if args.Subject == "set" && !Harness.Owns(args.Get("harness"), "claude-profile") &&
                    (args.Get("claude-profile") != "") {
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
                    "availability",
                } {
                    if args.Subject == "set" && key != "availability" {
                        if !partial && (key == "harness" || key == "provider" || key == "model" || key == "effort") {
                            args.Need(key)
                        } else if (key == "endpoint" || key == "pi-root" || key == "node") && args.Get(key) != "" &&
                            !Harness.Owns(args.Get("harness"), key) {
                            throw Exception("Pi runtime options require the pi harness")
                        }
                    } else if args.Subject != "check" && args.Get(key) != "" {
                        throw Exception("defaults " + args.Subject + " does not take --" + key)
                    }
                }
            }

            if args.Command == "claim" && args.Get("source") == "external" {
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
            }

            if args.Get("all") != "" && (args.Get("repo") != "" || args.Get("issue") != "" || args.Get("run") != "") {
                throw Exception("--all applies only to bare status")
            }

            if args.Get("run") != "" && command.SupportsSavedRun {
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

            let local = command.Needs("repo") || (args.Command == "status" && args.Get("issue") != "")

            if local && args.Get("repo") == "" {
                args.Values["--repo"] = RepositoryInput.Local()
            }
        }
    }
}
