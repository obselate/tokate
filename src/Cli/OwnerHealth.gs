package Tokate

import System
import System.Collections.Generic
import System.Text.Json
import System.Text.RegularExpressions

internal class OwnerHealth {
    private let Checks List[Object] = List[Object]()
    private var Failure Exception? = nil

    private func Add(
        name string,
        status string,
        message string,
        data Dictionary[string, Object?] = nil,
        command([]string)? = nil
    ) {
        let row = data ?? map[string, Object?]{}
        row["check"] = name
        row["status"] = status
        row["message"] = message
        let action = command ?? []string{}
        if action.Length > 0 {
            row["command"] = action
            if status == "problem" {
                PublicOutput.Actions.Add(action)
            }
        }
        Checks.Add(row)
        if !PublicOutput.Enabled {
            Console.WriteLine(Terminal.Clean(name + ": " + status + " - " + message.Replace('\n', ' ')))
        }
    }

    private suspend func Read(name string, read async () -> void) {
        try {
            await read()
        } catch (error Exception) {
            Failure = Failure ?? error
            Add(
                name,
                "problem",
                error is CliFailure failure ? failure.Summary: "Required remote data is unavailable or malformed."
            )
        }
    }

    private func Inspect(repo string, info JsonElement) {
        let revision = GitHub.Branch(repo, J.Text(info, "default_branch"))
        let version = ApplicationInfo.Version()
        var pin = ""
        var policyParsed bool
        Read(
            "coordinator",
            async () -> {
                let yaml = GitHub.FileAt(repo, ".github/workflows/tokate-coordinator.yml", revision, missing: true)
                let member = Regex.Matches(
                    yaml,
                    "(?m)^\\s*member:\\s*['\"]?tokate-([0-9]+\\.[0-9]+\\.[0-9]+)-linux-x64/tokate['\"]?\\s*$"
                )
                let uses = Regex.Matches(
                    yaml,
                    "(?m)^\\s*uses:\\s*['\"]?obselate/tokate/\\.github/workflows/tokate-shared\\.yml@([0-9a-f]{40})['\"]?\\s*$"
                )
                let configured = member.Count == 1 && uses.Count == 1
                let pinnedVersion = member.Count == 1 ? member[0].Groups[1].Value: ""
                pin = uses.Count == 1 ? uses[0].Groups[1].Value: ""
                let matches = configured && pinnedVersion == version
                let command = []string{"tokate", "coordinator-setup", repo, "--output", "tokate-coordinator.yml"}
                Add(
                    "coordinator",
                    !configured ? "problem": matches ? "ok": "warning",
                    "Member version " +
                        (pinnedVersion == "" ? "missing or malformed": pinnedVersion) +
                        ", CLI " +
                        version +
                        "." +
                        (
                        matches ? " Versions match.": " Review and install the entry from: " + String.Join(
                            " ",
                            command
                        ) +
                            "."
                    ),
                    map[string, Object?]{
                        "version": pinnedVersion,
                        "cli_version": version,
                        "matches_cli": matches,
                        "pin": pin
                    },
                    matches ? []string{}: command
                )
            }
        )
        Read(
            "release",
            async () -> {
                let release = GitHub.Api("repos/obselate/tokate/releases/latest", missing: true)
                if release.ValueKind == JsonValueKind.Undefined {
                    Add("release", "warning", "No stable release is available.")
                    return
                }
                let tag = J.Text(release, "tag_name")
                var latest Version
                var current Version
                if !tag.StartsWith("v") || !Version.TryParse(tag.Substring(1), out latest) || !Version.TryParse(
                    version,
                    out current
                ) {
                    throw Exception("Invalid stable release version")
                }
                let newer = latest > current
                Add(
                    "release",
                    newer ? "warning": "ok",
                    "Latest stable release " +
                        tag +
                        "." +
                        (
                        newer ? " Update the CLI with: tokate update. Then update the coordinator with tokate coordinator-setup " +
                            repo +
                            " --output tokate-coordinator.yml.": " No newer release exists."
                    ),
                    map[string, Object?]{"latest_version": tag.Substring(1), "newer_release": newer},
                    newer ? []string{"tokate", "update"}: []string{}
                )
            }
        )
        let settings = "Settings > Actions > General"
        let openSettings = []string{"gh", "browse", "--repo", repo, "settings/actions"}
        Read(
            "actions",
            async () -> {
                let permissions = GitHub.Api("repos/" + repo + "/actions/permissions")
                let enabled = J.Bool(permissions, "enabled")
                let allowed = J.Text(permissions, "allowed_actions")
                Add(
                    "actions",
                    enabled ? "ok": "problem",
                    "Actions " +
                        (enabled ? "enabled": "disabled") +
                        ", allowed_actions " +
                        allowed +
                        "." +
                        (enabled ? "": " Enable Actions in " + settings + " > Actions permissions."),
                    J.Select(permissions, "enabled,allowed_actions"),
                    enabled ? []string{}: openSettings
                )
                if !enabled {
                    return
                }
                var permitted = allowed == "all" || repo.StartsWith("obselate/", StringComparison.OrdinalIgnoreCase)
                var blocked bool
                let patterns = List[string]()
                if allowed == "selected" {
                    let selected = GitHub.Api("repos/" + repo + "/actions/permissions/selected-actions")
                    let values = J.Get(selected, "patterns_allowed")
                    if values.ValueKind != JsonValueKind.Array {
                        throw Exception("Invalid selected Actions patterns")
                    }
                    for pattern in J.Items(values) {
                        if pattern.ValueKind != JsonValueKind.String {
                            throw Exception("Invalid selected Actions pattern")
                        }
                        let value = pattern.GetString() ?? ""
                        patterns.Add(value)
                        let deny = value.StartsWith("!")
                        let matches = pin != "" && CoordinatorSetup.WorkflowMatches(
                            deny ? value.Substring(1): value,
                            "obselate/tokate/.github/workflows/tokate-shared.yml@" + pin
                        )
                        blocked = blocked || (deny && matches)
                        permitted = permitted || (!deny && matches)
                    }
                }
                permitted = permitted && !blocked
                Add(
                    "workflow_allowlist",
                    pin == "" ? "warning": permitted ? "ok": "problem",
                    pin == "" ? "Pinned workflow is unknown. Repair the coordinator entry before checking its allowlist.": "Pinned shared workflow " +
                        (
                        permitted ? "permitted.": "blocked. In " +
                            settings +
                            " > Actions permissions, allow obselate/tokate/.github/workflows/tokate-shared.yml@" +
                            pin +
                            "."
                    ),
                    map[string, Object?]{
                        "pin": pin,
                        "patterns_allowed": patterns,
                        "permitted": pin == "" ? nil: permitted
                    },
                    pin != "" && !permitted ? openSettings: []string{}
                )
            }
        )
        Read(
            "workflow_permissions",
            async () -> {
                let permissions = GitHub.Api("repos/" + repo + "/actions/permissions/workflow")
                let defaults = J.Text(permissions, "default_workflow_permissions")
                let create = J.Bool(permissions, "can_approve_pull_request_reviews")
                Add(
                    "workflow_permissions",
                    !create ? "problem": "ok",
                    "Default workflow permissions: " +
                        defaults +
                        ". Actions may create pull requests: " +
                        (create ? "yes.": "no.") +
                        (
                        !create ? " In " +
                            settings +
                            " > Workflow permissions, enable Allow GitHub Actions to create and approve pull requests.": ""
                    ),
                    J.Select(permissions, "default_workflow_permissions,can_approve_pull_request_reviews"),
                    !create ? openSettings: []string{}
                )
            }
        )
        Read(
            "policy",
            async () -> {
                let text = GitHub.FileAt(repo, ".github/tokate.json", revision, missing: true)
                try {
                    let policy = Policy(text)
                    policyParsed = true
                    Add(
                        "policy",
                        "ok",
                        "Version " + J.Number(policy.Value, "version").ToString() +
                            ", eligibility " +
                            policy.Eligibility +
                            ", parses.",
                        map[string, Object?]{
                            "version": J.Get(policy.Value, "version"),
                            "eligibility": policy.Eligibility,
                            "parses": true
                        }
                    )
                } catch (error Exception) {
                    var value JsonElement
                    try {
                        value = J.Parse(text)
                    } catch (invalid Exception) { }
                    let fields = J.Select(value, "version,eligibility")
                    fields["parses"] = false
                    Add(
                        "policy",
                        "problem",
                        "Version " +
                            (J.Number(value, "version") == 0 ? "unknown": J.Number(value, "version").ToString()) +
                            ", eligibility " +
                            (J.Text(value, "eligibility") == "" ? "unknown": J.Text(value, "eligibility")) +
                            ". " +
                            error.Message +
                            " Review the policy with tokate init " +
                            repo +
                            ".",
                        fields,
                        []string{"tokate", "init", repo}
                    )
                }
            }
        )
        Read(
            "access",
            async () -> {
                let access = AccessState.Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")), missing: true)
                var trusted int32
                for member in access.Members {
                    if J.Bool(member, "trusted") && !J.Bool(member, "denied") {
                        trusted++
                    }
                }
                let present = access.Sha != ""
                Add(
                    "access",
                    present ? "ok": "problem",
                    (present ? "Present": "Missing. Run: tokate access init " + repo) +
                        ". Members " +
                        access
                        .Members
                        .Count
                        .ToString() +
                        ", trusted " +
                        trusted.ToString() + ".",
                    map[string, Object?]{
                        "present": present,
                        "member_count": access.Members.Count,
                        "trusted_count": trusted
                    },
                    present ? []string{}: []string{"tokate", "access", "init", repo}
                )
            }
        )
        Read(
            "approvals",
            async () -> {
                if !policyParsed {
                    Add("approvals", "warning", "Approval freshness cannot be checked until the policy parses.")
                    return
                }
                var count int32
                var stale int32
                var page = 1
                while true {
                    let issues = GitHub.Api(
                        "repos/" +
                            repo +
                            "/issues?state=open&labels=tokate%3Aapproved&per_page=100&page=" +
                            page.ToString()
                    )
                    if issues.ValueKind != JsonValueKind.Array {
                        throw Exception("Invalid approved issue list")
                    }
                    for issue in J.Items(issues) {
                        if J.Get(issue, "pull_request").ValueKind != JsonValueKind.Undefined {
                            continue
                        }
                        let number = J.Number(issue, "number")
                        count++
                        try {
                            CoordinationState.Load(repo, number).CheckApproval(repo, number, quiet: true)
                        } catch (error CliFailure) {
                            if error.Code != "stale_approval" {
                                throw error
                            }
                            stale++
                            Add(
                                "approval",
                                "problem",
                                error.Summary,
                                map[string, Object?]{"issue": number, "current": false},
                                error.Action
                            )
                        }
                    }
                    if issues.GetArrayLength() < 100 {
                        Add(
                            "approvals",
                            stale == 0 ? "ok": "problem",
                            count.ToString() + " approved issues checked, " + stale.ToString() + " stale.",
                            map[string, Object?]{"approved_count": count, "stale_count": stale}
                        )
                        return
                    }
                    page++
                }
            }
        )
        Read(
            "last_run",
            async () -> {
                let runs = Submission.WorkflowRuns(repo, "per_page=1", missing: true)
                let rows = J.Items(J.Get(runs, "workflow_runs"))
                if runs.ValueKind != JsonValueKind.Undefined && J.Get(runs, "workflow_runs")
                    .ValueKind != JsonValueKind.Array {
                    throw Exception("Invalid workflow run list")
                }
                if rows.Count == 0 {
                    Add("last_run", "warning", "No Tokate workflow run found.")
                    return
                }
                let run = rows[0]
                let conclusion = J.Text(run, "conclusion")
                let status = J.Text(run, "status")
                Add(
                    "last_run",
                    conclusion == "success" ? "ok": conclusion == "startup_failure" ||
                        conclusion == "failure" ? "problem": "warning",
                    (conclusion == "" ? status: conclusion) + " " + J.Text(run, "html_url") +
                        (conclusion == "startup_failure" ? " " + Submission.StartupFailure: ""),
                    map[string, Object?]{
                        "status": status,
                        "conclusion": conclusion,
                        "html_url": J.Text(run, "html_url")
                    },
                    conclusion == "startup_failure" ? openSettings: conclusion == "failure" ? []string{
                        "gh",
                        "browse",
                        J.Text(run, "html_url")
                    }: []string{}
                )
            }
        )
    }

    shared {
        internal func Run(args Args) int32 {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let health = OwnerHealth()
            PublicOutput.ResultData = map[string, Object?]{"scope": "owner", "repo": repo, "checks": health.Checks}
            health.Inspect(repo, GitHub.Api("repos/" + repo))
            if let failure = health.Failure {
                throw failure
            }
            return 0
        }
    }
}
