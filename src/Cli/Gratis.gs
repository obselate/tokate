package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class Gratis {
    shared {
        internal func PolicyFor(options Args, guidance JsonElement) Policy {
            DonorDefaults.NormalizePair(options)
            let tools = []Object{
                map[string, Object?]{"harness": options.Get("harness", "codex"), "provider": options.Need("provider")}
            }
            return Policy(
                J.Write(
                    map[string, Object?]{
                        "version": 3,
                        "eligibility": "open",
                        "approval_scope": "task",
                        "max_seconds": 86400,
                        "allowed_tools": tools,
                        "verification": J.Get(guidance, "verification"),
                        "required_checks": []string{}
                    }
                ),
                gratis: true
            )
        }

        internal func Snapshot(repo string) JsonElement {
            let pulls = List[Object]()
            var page int32 = 1
            while true {
                let rows = GitHub.Api("repos/" + repo + "/pulls?state=open&per_page=100&page=" + page.ToString())
                if rows.ValueKind != JsonValueKind.Array {
                    throw CliFailure("invalid_state", "Open PR snapshot is incomplete")
                }
                for row in J.Items(rows) {
                    let number = J.Number(row, "number")
                    let pull = GitHub.Api("repos/" + repo + "/pulls/" + number.ToString())
                    let files = List[Object]()
                    var filePage int32 = 1
                    while true {
                        let changed = GitHub.Api(
                            "repos/" + repo + "/pulls/" + number.ToString() +
                                "/files?per_page=100&page=" +
                                filePage.ToString()
                        )
                        if changed.ValueKind != JsonValueKind.Array {
                            throw CliFailure("invalid_state", "Open PR changed files are incomplete")
                        }
                        for file in J.Items(changed) {
                            files.Add(J.Select(file, "filename,previous_filename,status"))
                        }
                        if changed.GetArrayLength() < 100 || files.Count == J.Number(pull, "changed_files") {
                            break
                        }
                        if++ filePage > 30 {
                            throw CliFailure("invalid_state", "Open PR changed files exceed the snapshot limit")
                        }
                    }
                    if J.Get(pull, "changed_files").ValueKind != JsonValueKind.Number || files.Count != J.Number(
                        pull,
                        "changed_files"
                    ) {
                        throw CliFailure("invalid_state", "Open PR changed file count differs from the snapshot")
                    }
                    let linked = List[Object]()
                    var cursor = ""
                    while true {
                        let result = Graph(
                            "query($$owner:String!,$$name:String!,$$number:Int!,$$cursor:String){repository(owner:$$owner,name:$$name){pullRequest(number:$$number){closingIssuesReferences(first:100,after:$$cursor){nodes{number title repository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}}",
                            map[string, Object?]{
                                "owner": repo.Split('/')[0],
                                "name": repo.Split('/')[1],
                                "number": number,
                                "cursor": cursor == "" ? nil: cursor
                            }
                        )
                        let refs = J.Get(J.Get(J.Get(result, "repository"), "pullRequest"), "closingIssuesReferences")
                        if J.Get(refs, "nodes").ValueKind != JsonValueKind.Array || J.Get(
                            J.Get(refs, "pageInfo"),
                            "hasNextPage"
                        )
                            .ValueKind == JsonValueKind.Undefined {
                            throw CliFailure("invalid_state", "Open PR linked issues are incomplete")
                        }
                        for issue in J.Items(J.Get(refs, "nodes")) {
                            linked.Add(issue)
                        }
                        if !J.Bool(J.Get(refs, "pageInfo"), "hasNextPage") {
                            break
                        }
                        let next = J.Text(J.Get(refs, "pageInfo"), "endCursor")
                        if next == "" || next == cursor || linked.Count > 10000 {
                            throw CliFailure("invalid_state", "Open PR linked issue pagination is incomplete")
                        }
                        cursor = next
                    }
                    pulls.Add(
                        map[string, Object?]{
                            "number": number,
                            "title": J.Text(pull, "title"),
                            "body": J.Text(pull, "body"),
                            "linked_issues": linked,
                            "changed_files": files
                        }
                    )
                }
                if rows.GetArrayLength() < 100 {
                    return J.Parse(J.Write(pulls))
                }
                if++ page > 100 {
                    throw CliFailure("invalid_state", "Open PR snapshot exceeds the discovery limit")
                }
            }
        }

        internal func Graph(query string, variables Dictionary[string, Object?]) JsonElement {
            let response = GitHub.Api("graphql", map[string, Object?]{"query": query, "variables": variables})
            if J.Count(J.Get(response, "errors")) > 0 || J.Get(response, "data").ValueKind != JsonValueKind.Object {
                throw CliFailure("command_failed", "GitHub graph request failed")
            }
            return J.Get(response, "data")
        }

        internal func Pick(repo string, attempted HashSet[int32], snapshot JsonElement) JsonElement {
            var page int32 = 1
            while true {
                let issues = GitHub.Api(
                    "repos/" +
                        repo +
                        "/issues?state=open&sort=created&direction=asc&per_page=100&page=" +
                        page.ToString()
                )
                if issues.ValueKind != JsonValueKind.Array {
                    throw CliFailure("invalid_state", "Eligible issue discovery is incomplete")
                }
                for issue in J.Items(issues) {
                    let number = J.Number(issue, "number")
                    if number < 1 || attempted.Contains(number) || J.Get(issue, "pull_request")
                        .ValueKind != JsonValueKind.Undefined ||
                        J.Text(issue, "state") != "open" || J.Get(issue, "locked")
                        .ValueKind != JsonValueKind.False ||
                        J
                        .Get(issue, "assignees").ValueKind != JsonValueKind.Array || J.Count(
                        J.Get(issue, "assignees")
                    ) != 0 {
                        continue
                    }
                    var linked bool
                    for pull in J.Items(snapshot) {
                        for reference in J.Items(J.Get(pull, "linked_issues")) {
                            linked = linked ||
                                (
                                J.Number(reference, "number") == number && RepositoryIdentity.SameRepo(
                                    J.Text(J.Get(reference, "repository"), "nameWithOwner"),
                                    repo
                                )
                            )
                        }
                    }
                    var timelinePage int32 = 1
                    while !linked {
                        let timeline = GitHub.Api(
                            "repos/" + repo + "/issues/" + number.ToString() +
                                "/timeline?per_page=100&page=" +
                                timelinePage.ToString()
                        )
                        if timeline.ValueKind != JsonValueKind.Array {
                            throw CliFailure("invalid_state", "Issue overlap evidence is incomplete")
                        }
                        for event in J.Items(timeline) {
                            let source = J.Get(J.Get(event, "source"), "issue")
                            linked = linked ||
                                (
                                J.Get(source, "pull_request").ValueKind == JsonValueKind.Object && J.Text(
                                    source,
                                    "state"
                                ) == "open"
                            )
                        }
                        if timeline.GetArrayLength() < 100 {
                            break
                        }
                        if++ timelinePage > 100 {
                            throw CliFailure("invalid_state", "Issue overlap evidence exceeds the discovery limit")
                        }
                    }
                    if !linked {
                        return issue
                    }
                }
                if issues.GetArrayLength() < 100 {
                    return JsonElement{}
                }
                if++ page > 100 {
                    throw CliFailure("invalid_state", "Eligible issue discovery exceeds the discovery limit")
                }
            }
        }

        internal func Prepare(
            options Args,
            revision string,
            guidance JsonElement,
            prompt string,
            snapshot JsonElement,
            issue JsonElement,
            policy Policy,
            selection JsonElement
        ) string {
            let repo = options.Need("repo")
            let viewer = GitHub.Api("user")
            let donor = RepositoryIdentity.Login(J.Text(viewer, "login"))
            let id = Guid.NewGuid().ToString("D")
            let record = J.Parse(
                J.Write(
                    map[string, Object?]{
                        "policy": policy.Value,
                        "selection": selection,
                        "issue": issue.ValueKind == JsonValueKind.Undefined ? J.Parse(
                            "{\"number\":0,\"title\":\"Donated repository task\",\"body\":\"\"}"
                        ): issue,
                        "approval": map[string, Object?]{
                            "base": revision,
                            "decree": J.Parse("{\"present\":false,\"sha256\":null,\"text\":\"\"}")
                        },
                        "guidance": guidance,
                        "prompt": prompt,
                        "open_prs": snapshot
                    }
                )
            )
            let run = Data(
                map[string, Object?]{
                    "version": 2,
                    "mode": "gratis",
                    "repo": repo,
                    "issue": J.Number(issue, "number"),
                    "donor": donor,
                    "donor_id": J.Get(viewer, "id"),
                    "source": "tokate",
                    "id": id,
                    "attempt": id,
                    "branch": "tokate/v2-" + id,
                    "base": revision,
                    "base_branch": J.Text(GitHub.Api("repos/" + repo), "default_branch"),
                    "policy_hash": policy.Digest,
                    "seconds": options.Number("seconds"),
                    "selection": selection,
                    "tools": []Object{J.Select(selection, "harness,provider,model,effort")},
                    "gratis": record,
                    "gratis_hash": Data.Hash(J.Write(record)),
                    "prompt_hash": Data.Hash(prompt)
                }
            )
            if options.Get("verification-reserve") != "" {
                run.Fields["verification_reserve"] = RuntimeBudget.Reserve(options, run.Number("seconds"))
            }
            for key in[]string{"harness", "provider", "model", "effort"} {
                run.Fields[key] = J.Text(selection, key)
            }
            for key in[]string{"harness-path", "claude-profile", "endpoint", "pi-root", "node"} {
                if options.Get(key) != "" {
                    let field = key == "endpoint" ? "pi_endpoint": key == "pi-root" ? "pi_root": key == "node" ? "pi_node": key.Replace(
                        '-',
                        '_'
                    )
                    run.Fields[field] = options.Get(key)
                }
            }
            let directory = RunStorage.Allocate(RunStorage.Store(options), repo, run.Number("issue"), id)
            PublicOutput.RunDirectory = directory
            run.Fields["name"] = Path.GetFileName(directory)
            WorkspacePreparation.Select(run, options.Get("fork", donor + "/" + repo.Split('/')[1]))
            if RepositoryIdentity.SameRepo(run.Text("head_repo"), repo) {
                throw CliFailure("invalid_state", "Gratis publication requires a donor fork")
            }
            Directory.CreateDirectory(
                directory,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            )
            using let lease = RunStorage.Lease(directory)
            WorkspacePreparation.Initialize(directory, run, options.Get("fork"))
            File.WriteAllText(Path.Combine(directory, "open-prs.json"), J.Write(snapshot))
            File.WriteAllText(Path.Combine(directory, "task-prompt.txt"), prompt)
            WorkspacePreparation.Complete(directory, run)
            return directory
        }

        internal func Recheck(run Data, viewer JsonElement) JsonElement {
            let record = J.Get(run.Element(), "gratis")
            if !RepositoryIdentity.SameDonor(viewer, run) || run.Text("source") != "tokate" || run.Flag("unlimited") ||
                run.Text("gratis_hash") != Data.Hash(J.Write(record)) || run.Text("prompt_hash") != Data.Hash(
                J.Text(record, "prompt")
            ) ||
                run.Text("branch") != "tokate/v2-" + run.Text("id") || run.Text("base") != J.Text(
                J.Get(record, "approval"),
                "base"
            ) ||
                RepositoryIdentity
                .SameRepo(run.Text("head_repo"), run.Text("repo")) {
                throw CliFailure("invalid_state", "Saved gratis task identity changed")
            }
            let revision = GitHub.Branch(run.Text("repo"), run.Text("base_branch"))
            if GitHub.Api("repos/" + run.Text("repo") + "/contents/.github/tokate.json?ref=" + revision, missing: true)
                .ValueKind != JsonValueKind.Undefined {
                throw CliFailure("invalid_state", "Repository now has a Tokate policy; gratis work stopped")
            }
            if revision != run.Text("base") && !RequestData.Same(
                GratisGuidance.Discover(run.Text("repo"), revision),
                J.Get(record, "guidance")
            ) {
                throw CliFailure("invalid_state", "Repository guidance changed; gratis work stopped")
            }
            let policy = Policy(J.Write(J.Get(record, "policy")), gratis: true)
            if policy.Digest != run.Text("policy_hash") {
                throw CliFailure("invalid_state", "Saved gratis limits changed")
            }
            let tools = J.Get(run.Element(), "tools")
            RequestData.Tools(tools)
            policy.ValidateTools(tools, "tokate")
            let selected = J.Get(run.Element(), "selection")
            if !RequestData.Same(selected, J.Get(record, "selection")) || run.Number("issue") != J.Number(
                J.Get(record, "issue"),
                "number"
            ) ||
                J.Text(J.Get(record, "guidance"), "blocked") != "" {
                throw CliFailure("invalid_state", "Saved gratis task inputs changed or forbid work")
            }
            let declared = J.Items(tools)[0]
            for key in[]string{"harness", "provider", "model", "effort"} {
                if run.Text(key) != J.Text(selected, key) || run.Text(key) != J.Text(declared, key) {
                    throw CliFailure("invalid_state", "Saved gratis tool declaration changed")
                }
            }
            RuntimeBudget.Validate(run)
            policy.ValidateBudget(run.Number("seconds"), false)
            if run.Text("state") != "preparing" {
                RepositoryAccess.ValidateRun(run)
            }
            return record
        }

        internal func Outcome(directory string, checkout string, run Data, budget RuntimeBudget) bool {
            let findings = Path.Combine(checkout, "tokate-findings.md")
            if File.Exists(findings) || FileInfo(findings).LinkTarget != nil {
                RunStorage.ControlFile(checkout, "tokate-findings.md")
                if budget.Git(checkout, "ls-files", "--", "tokate-findings.md") != "" {
                    throw CliFailure("invalid_state", "Findings artifact conflicts with a repository-owned file")
                }
                if FileInfo(findings).Length > 65536 {
                    throw CliFailure("invalid_state", "Findings exceed 64 KiB")
                }
                File.WriteAllText(
                    Path.Combine(directory, "findings.md"),
                    File.ReadAllText(findings, System.Text.UTF8Encoding(false, true))
                )
                File.Delete(findings)
            }
            let artifact = Path.Combine(checkout, "tokate-public-summary.json")
            if File.Exists(artifact) {
                PublicSummary.Capture(directory, checkout, run)
            }
            if budget.Git(checkout, "status", "--porcelain") != "" {
                return false
            }
            run.Fields["state"] = File.Exists(Path.Combine(directory, "findings.md")) && !String.IsNullOrWhiteSpace(
                File.ReadAllText(Path.Combine(directory, "findings.md"))
            ) ? "findings": "skipped"
            run.Fields.Remove("failure_stage")
            run.Fields.Remove("failure_reason")
            run.Save(directory)
            return true
        }
    }
}
