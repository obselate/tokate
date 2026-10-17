package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json
import System.Text.RegularExpressions

internal class OwnerHealth {
    private let Checks List[Object] = List[Object]()
    private var Failure Exception? = nil
    private var Parsed Policy? = nil

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
        Read(
            "coordinator",
            async () -> {
                let yaml = GitHub.FileAt(repo, OwnerSetup.CoordinatorWorkflowPath, revision, missing: true)
                pin = CoordinatorSetup.Pin(yaml)
                let pinnedVersion = pin == "" || pin == "v0" ? "": PinnedVersion(pin)
                let configured = pin != ""
                let matches = configured && (pin == "v0" || pinnedVersion == version)
                let command = []string{"tokate", "init", repo, "--pin"}
                Add(
                    "coordinator",
                    !configured ? "problem": matches ? "ok": "warning",
                    !configured ? "Coordinator workflow is missing or malformed. Run tokate init " + repo + ".":
                    pin == "v0" ? "Coordinator follows stable-major releases at v0.":
                    "Pinned version " +
                        pinnedVersion +
                        ", CLI " +
                        version +
                        (matches ? ".": ". Update it with: " + String.Join(" ", command) + "."),
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
        let openSettings = []string{"gh", "browse", "--repo", repo, "settings/actions"}
        if J.Bool(J.Get(info, "permissions"), "admin") {
            InspectActions(repo, pin)
            Read(
                "event_policy",
                async () -> {
                    CoordinatorSetup.EventPolicy(repo, OwnerSetup.CoordinatorWorkflowPath)
                    Add("event_policy", "ok", "No blocking Actions event policy found.")
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
                                ActionsSettingsLocation +
                                " > Workflow permissions, enable Allow GitHub Actions to create and approve pull requests.": ""
                        ),
                        J.Select(permissions, "default_workflow_permissions,can_approve_pull_request_reviews"),
                        !create ? openSettings: []string{}
                    )
                }
            )
        } else {
            Add("actions", "warning", "Requires repository admin access.")
        }
        InspectPolicyAndAccess(repo, info, revision)
        InspectApprovals(repo)
        InspectLastRun(repo, openSettings)
    }

    private func InspectPolicyAndAccess(repo string, info JsonElement, revision string) {
        Read(
            "policy",
            async () -> {
                let text = GitHub.FileAt(repo, Policy.FilePath, revision, missing: true)
                try {
                    let policy = Policy(text)
                    Parsed = policy
                    let policyVersion = policy.Version.ToString()
                    Add("policy", "ok", "Version " + policyVersion + ", eligibility " + policy.Eligibility + ".")
                } catch (error Exception) {
                    let command = []string{"tokate", "init", repo}
                    Add(
                        "policy",
                        "problem",
                        error.Message + " Review the policy with: " + String.Join(" ", command) + ".",
                        command: command
                    )
                }
            }
        )
        Read(
            "access",
            async () -> {
                let access = AccessState.Load(repo, RepositoryIdentity.PositiveId(J.Get(info, "id")))
                var trusted int32
                for member in access.Members {
                    if member.Trusted && !member.Denied {
                        trusted++
                    }
                }
                let present = access.Sha != ""
                Add(
                    "access",
                    "ok",
                    (present ? "Present": "Empty access record") +
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
                    []string{}
                )
            }
        )
    }

    private func InspectApprovals(repo string) {
        Read(
            "approvals",
            async () -> {
                if Parsed == nil {
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
                            "/issues?state=open&labels=" +
                            GitHub.EncodedApprovedLabel +
                            "&" +
                            GitHub.PageSizeParameter +
                            "&page=" +
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
                    if issues.GetArrayLength() < GitHub.PageSize {
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
    }

    private func InspectLastRun(repo string, openSettings[]string) {
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

    private func InspectActions(repo string, pin string) {
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
                        (enabled ? "": " Enable Actions in " + ActionsSettingsLocation + " > Actions permissions."),
                    J.Select(permissions, "enabled,allowed_actions"),
                    enabled ? []string{}: openSettings
                )
                if !enabled {
                    return
                }
                let allowlist = CoordinatorSetup.Allowlist(
                    repo,
                    allowed,
                    "obselate/tokate/.github/workflows/tokate-shared.yml@" + pin
                )
                let permitted = allowlist.Permitted
                Add(
                    "workflow_allowlist",
                    pin == "" ? "warning": permitted ? "ok": "problem",
                    pin == "" ? "Pinned workflow is unknown. Repair the coordinator entry before checking its allowlist.": "Pinned shared workflow " +
                        (
                        permitted ? "permitted.": "blocked. In " +
                            ActionsSettingsLocation +
                            " > Actions permissions, allow obselate/tokate/.github/workflows/tokate-shared.yml@" +
                            pin +
                            "."
                    ),
                    map[string, Object?]{
                        "pin": pin,
                        "patterns_allowed": allowlist.Patterns,
                        "permitted": pin == "" ? nil: permitted
                    },
                    pin != "" && !permitted ? openSettings: []string{}
                )
            }
        )
    }

    shared {
        private const ActionsSettingsLocation string = "Settings > Actions > General"

        private func PinnedVersion(pin string) string ->
        GitHub.FileAt("obselate/tokate", "VERSION", pin).Trim()

        private func Older(version string, other string) bool {
            var current Version
            var latest Version
            if !Version.TryParse(version, out current) || !Version.TryParse(other, out latest) {
                throw Exception("Invalid stable release version")
            }
            return current < latest
        }

        internal func WarnCoordinator(args Args) {
            try {
                let repo = RepositoryIdentity.Repo(
                    args.Get("run") != "" ? Data.Load(Path.GetFullPath(args.Need("run"))).Repo:
                    args.Get("repo") != "" ? args.Need("repo"): RepositoryInput.Local()
                )
                let yaml = GitHub.FileAt(repo, OwnerSetup.CoordinatorWorkflowPath, missing: true)
                let pin = CoordinatorSetup.Pin(yaml)
                if pin == "" || pin == "v0" {
                    return
                }
                let pinned = PinnedVersion(pin)
                let version = ApplicationInfo.Version()
                if pinned != "" && Older(pinned, version) {
                    Terminal.Message(
                        "Warning: Repository coordinator " +
                            pinned +
                            " is older than CLI " +
                            version +
                            ". Owner: update it with: tokate init --pin " +
                            repo +
                            ".",
                        "yellow",
                        true
                    )
                }
            } catch (error Exception) {
                Terminal.Message("Warning: Repository coordinator version could not be checked.", "yellow", true)
            }
        }

        internal func Run(args Args) int32 {
            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let health = OwnerHealth()
            let data = map[string, Object?]{"scope": "repo", "repo": repo, "checks": health.Checks}
            PublicOutput.ResultData = data
            health.Inspect(repo, GitHub.Api("repos/" + repo))
            if let policy = health.Parsed {
                data["policy"] = PublicOutput.Policy(policy.Value)
                if !PublicOutput.Enabled {
                    Terminal.Json(policy.Value, "Repository policy")
                }
            }
            if !PublicOutput.Enabled {
                for check in health.Checks {
                    if check is Dictionary[string, Object?]row {
                        let text = (row["status"] as string ?? "") + " - " + (row["message"] as string ?? "")
                        Terminal.Row(row["check"] as string ?? "", text)
                    }
                }
            }
            if let failure = health.Failure {
                throw failure
            }
            return 0
        }
    }
}
