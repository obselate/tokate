package Tokate

import System
import System.Collections.Generic
import System.Text
import System.Text.Json
import System.Text.RegularExpressions

internal class OverlapContribution {
    internal let Number int32
    internal let Facts Dictionary[string, Object?]
    internal var Identity string = ""
    internal var Target string = ""
    internal var Binding Data? = nil
    internal var Files HashSet[string]? = nil
    internal var Stable bool

    internal init(number int32) {
        Number = number
        Facts = map[string, Object?]{
            "pr": number,
            "binding_status": "unknown",
            "identity_status": "unknown",
            "diff_status": "unknown",
            "checks_status": "unknown",
            "upstream_status": "unknown",
            "dependency_gate": "unknown"
        }
    }

    internal func Invalidate() {
        Facts["diff_status"] = "unknown"
        Facts["checks_status"] = "unknown"
        Facts["dependency_gate"] = "unknown"
        Facts["dependencies_status"] = "unknown"
        Files = nil
        Facts["upstream_status"] = "unknown"
        Facts.Remove("upstream_file_count")
        Facts.Remove("upstream_overlap_count")
        Facts.Remove("upstream_paths")
        Facts.Remove("upstream_paths_complete")
        Facts.Remove("upstream_next")
    }
}

internal class Overlaps {
    shared {
        private let Advisory string = "Filename overlap is advisory and never blocks work or determines merge order. Disjoint files and clean merge metadata do not prove semantic compatibility. Closed-completed dependencies remove only the open-dependency gate; they do not prove implementation completion. Previous checks and owner review do not verify a new head or target. Owners retain final acceptance; use verify and checks for single-contribution gates."
        private var Remaining int32 = 24000

        private func Retain(rows List[Object], item Object) {
            let bytes = Encoding.UTF8.GetByteCount(J.Write(item))
            if bytes > Remaining {
                Output.Sink.Truncated = true
                return
            }

            Remaining -= bytes
            rows.Add(item)
        }

        private func Identity(pull JsonElement) string -> J.Write(
            map[string, Object?]{
                "head": J.Select(J.Get(pull, "head"), "sha,ref"),
                "head_repo": J.Text(J.Get(J.Get(pull, "head"), "repo"), "full_name"),
                "target": J.Text(J.Get(pull, "base"), "ref"),
                "target_repo": J.Text(J.Get(J.Get(pull, "base"), "repo"), "full_name"),
                "body_hash": J.Hash(J.Text(pull, "body"))
            }
        )

        private func Failure(facts Dictionary[string, Object?], key string, error Exception) {
            facts[key + "_status"] = "unknown"
            facts[key + "_error"] = error is CliFailure failure ? CliFailure.Message(
                failure.Code
            ): "Evidence unavailable, incomplete or changed; owner review required."
        }

        private func Resolution(issue JsonElement) Object {
            let result = J.Select(issue, "closed_at")
            let closer = J.Get(issue, "closed_by")

            if closer.ValueKind == JsonValueKind.Object {
                result["closed_by"] = J.Select(closer, "id,login")
            }

            for key in[]string{"duplicate_of", "resolution"} {
                let value = J.Get(issue, key)
                if value.ValueKind == JsonValueKind.Object {
                    result[key] = J.Select(value, "id,number,url,html_url,type,reason,state,state_reason")
                } else if value.ValueKind == JsonValueKind.String || value.ValueKind == JsonValueKind.Number {
                    result[key] = value
                }
            }

            return result
        }

        private func Dependencies(repo string, issue int32, facts Dictionary[string, Object?]) {
            let rows = List[Object]()
            facts["dependencies"] = rows
            facts["dependency_count"] = 0
            facts["dependencies_status"] = "incomplete"
            facts["dependencies_output_complete"] = true
            facts["dependency_gate"] = "unknown"

            let seen = HashSet[string](StringComparer.Ordinal)
            var complete bool
            var valid bool = true
            var blocked bool
            var review bool
            var count int32

            try {
                for page in 1 ... GitHub.PageCountLimit + 1 {
                    let value = GitHub.Api(
                        "repos/" + repo + "/issues/" + issue.ToString() +
                            "/dependencies/blocked_by?" +
                            GitHub.PageSizeParameter +
                            "&page=" +
                            page.ToString()
                    )

                    if value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > GitHub.PageSize {
                        throw CliFailure("invalid_state", "Incomplete native dependency evidence")
                    }

                    for dependency in value.EnumerateArray() {
                        count++
                        let url = J.Text(dependency, "url")

                        if url == "" || J.Number(dependency, "number") < 1 || !seen.Add(url) || J.Get(
                            dependency,
                            "pull_request"
                        )
                            .ValueKind != JsonValueKind.Undefined {
                            review = true
                            valid = false
                        }

                        let state = J.Text(dependency, "state")
                        let reason = J.Text(dependency, "state_reason")
                        let resolution = J.Parse(J.Write(Resolution(dependency)))
                        let nativeResolution = J.Get(resolution, "resolution")
                        let resolved = nativeResolution.ValueKind == JsonValueKind.Undefined ||
                            (
                            nativeResolution.ValueKind == JsonValueKind.String &&
                                nativeResolution.GetString() == "completed"
                        ) ||
                            (
                            nativeResolution.ValueKind == JsonValueKind.Object && J.Text(
                                nativeResolution,
                                "type"
                            ) == "completed"
                        )
                        let duplicate = J.Get(resolution, "duplicate_of")
                            .ValueKind != JsonValueKind.Undefined ||
                            J.Text(J.Get(resolution, "resolution"), "type") == "duplicate" || J.Text(
                            resolution,
                            "resolution"
                        ) == "duplicate"
                        let gate = state == "open" ? "blocking": (
                            state == "closed" &&
                                reason == "completed" &&
                                !duplicate &&
                                resolved ? "open_dependency_removed": "owner_review"
                        )

                        blocked = blocked || gate == "blocking"
                        review = review || gate == "owner_review"

                        let row = J.Select(dependency, "id,number,url,html_url,state,state_reason")
                        row["resolution"] = resolution
                        row["gate"] = gate

                        Retain(rows, row)
                        facts["dependency_count"] = count
                        facts["dependencies_output_complete"] = rows.Count == count
                        facts["dependency_gate"] = blocked ? "blocked": "unknown"
                    }

                    if value.GetArrayLength() < GitHub.PageSize {
                        complete = valid
                        break
                    }
                }
            } catch (error ApiDeadlineException) {
                throw error
            } catch (error Exception) when error is CliFailure || error is JsonException || error.GetType() == typeof(
                Exception
            ) {
                Failure(facts, "dependencies", error)
            } finally {
                facts["dependencies"] = rows
                facts["dependency_count"] = count
                facts["dependencies_status"] = complete ? "complete": "incomplete"
                facts["dependencies_output_complete"] = rows.Count == count
                facts["dependency_gate"] = blocked ? "blocked": (
                    !complete ? "unknown": (review ? "owner_review": "no_open_dependencies")
                )
            }
        }

        internal func DependencyEvidence(
            repo string,
            issue int32,
            evidence Dictionary[string, Object?]? = nil
        ) Dictionary[string, Object?] {
            let facts = evidence ?? Dictionary[string, Object?]()
            let remaining = Remaining

            try {
                Remaining = 24000
                Dependencies(repo, issue, facts)
            } finally {
                Remaining = remaining
            }

            return facts
        }

        internal func RequireDependencies(repo string, issue int32, evidence Dictionary[string, Object?]? = nil) {
            let facts = evidence ?? DependencyEvidence(repo, issue)
            ApiTransport.CheckDeadline()

            if facts["dependencies_status"]?.ToString() != "complete" ||
                facts["dependency_gate"]?.ToString() != "no_open_dependencies" {
                throw CliFailure("invalid_state", "Dependency evidence is blocked, incomplete or requires owner review")
            }
        }

        private func Upstream(
            repo string,
            item OverlapContribution,
            base string,
            target string,
            changes Dictionary[string, HashSet[string]]
        ) {
            let facts = item.Facts

            if target == "" {
                throw CliFailure("invalid_state", "Current target is unavailable")
            }

            let key = base + ":" + target
            if !changes.ContainsKey(key) {
                changes[key] = base == target ? HashSet[string](): GitHubPathEvidence.Diff(repo, base, repo, target)
            }

            let paths = List[string]()

            for path in changes[key] {
                if item.Files?.Contains(path) == true {
                    paths.Add(path)
                }
            }

            paths.Sort(StringComparer.Ordinal)

            let retained = List[Object]()

            for path in paths {
                Retain(retained, path)
            }

            facts["upstream_status"] = base == target ? "current": "changed"
            facts["upstream_file_count"] = changes[key].Count
            facts["upstream_overlap_count"] = paths.Count
            facts["upstream_paths"] = retained
            facts["upstream_paths_complete"] = retained.Count == paths.Count

            if base != target {
                facts["upstream_next"] = paths.Count > 0 ?
                "Owner: ask the current donor to merge the target, resolve overlapping paths, then run tokate amend with a verification budget. Further coding requires a new donor budget.":
                "Owner: no filename overlap was found. Review semantic compatibility and choose merge order. After merging the target, run tokate amend with a verification budget."
            }
        }

        private func Read(
            repo string,
            item OverlapContribution,
            targets Dictionary[string, string],
            changes Dictionary[string, HashSet[string]]
        ) {
            let facts = item.Facts

            try {
                let pull = GitHub.Api("repos/" + repo + "/pulls/" + item.Number.ToString())
                item.Identity = Identity(pull)

                let head = J.Get(pull, "head")
                facts["head"] = RepositoryIdentity.CommitSha(J.Text(head, "sha"))
                facts["head_branch"] = J.Text(head, "ref")
                facts["head_repo"] = RepositoryIdentity.Repo(J.Text(J.Get(head, "repo"), "full_name"))

                let branch = RepositoryIdentity.Branch(J.Text(J.Get(pull, "base"), "ref"))
                item.Target = branch
                facts["target_branch"] = branch

                if !targets.ContainsKey(branch) {
                    try {
                        targets[branch] = GitHub.Branch(repo, branch)
                    } catch (error Exception) when error is CliFailure ||
                        error is JsonException ||
                        error is ApiDeadlineException ||
                        error.GetType() == typeof(Exception) {
                        targets[branch] = ""
                    }
                }

                facts["target_revision"] = targets[branch]
                facts["pr_url"] = J.Text(pull, "html_url")
                facts["mergeable"] = J.Get(pull, "mergeable")
                    .ValueKind == JsonValueKind.True ? true: (
                    J.Get(pull, "mergeable").ValueKind == JsonValueKind.False ? false as Object: nil
                )

                let binding = ReceiptVerification.Verify(repo, item.Number, paths: false)

                item.Binding = binding
                facts["binding_status"] = "validated"
                facts["binding"] = J.Select(
                    binding.Element(),
                    "version,issue,approval,authority_revision,donor,base,base_branch,commit"
                )

                try {
                    let base = binding.VerifiedTargetRevision == "" ? binding.Base: binding.VerifiedTargetRevision

                    let files = GitHubPathEvidence.Diff(
                        repo,
                        base,
                        J.Text(J.Get(head, "repo"), "full_name"),
                        binding.Commit
                    )

                    item.Files = files
                    facts["diff_status"] = "complete"
                    facts["file_count"] = files.Count
                    facts["diff_base"] = base
                    facts["diff_head"] = binding.Commit

                    try {
                        Upstream(repo, item, base, targets[branch], changes)
                    } catch (error Exception) when error is CliFailure ||
                        error is JsonException ||
                        error is ApiDeadlineException ||
                        error.GetType() == typeof(Exception) {
                        Failure(facts, "upstream", error)
                    }
                } catch (error Exception) when error is CliFailure ||
                    error is JsonException ||
                    error is ApiDeadlineException ||
                    error.GetType() == typeof(Exception) {
                    Failure(facts, "diff", error)
                }

                try {
                    let checks = CommitChecks.Read(repo, binding.Commit)
                    let rows = List[Object]()

                    for check in J.Items(checks) {
                        Retain(rows, J.Select(check, "name,state,bucket,link,workflow"))
                    }

                    facts["checks"] = rows
                    facts["check_count"] = checks.GetArrayLength()
                    facts["checks_status"] = "complete"
                    facts["checks_output_complete"] = rows.Count == checks.GetArrayLength()
                    facts["checks_head"] = binding.Commit

                    let names = J.Items(Policy.Parse(binding.Policy).RequiredChecks)
                    let required = List[Object]()

                    for name in names {
                        Retain(required, name)
                    }

                    facts["required_checks"] = required
                    facts["required_check_count"] = names.Count
                } catch (error Exception) when error is CliFailure ||
                    error is JsonException ||
                    error is ApiDeadlineException ||
                    error.GetType() == typeof(Exception) {
                    Failure(facts, "checks", error)
                }

                Dependencies(repo, binding.Issue, facts)
            } catch (error Exception) when error is CliFailure ||
                error is JsonException ||
                error is ApiDeadlineException ||
                error.GetType() == typeof(Exception) {
                Failure(facts, "binding", error)
            }
        }

        private func Recheck(repo string, items List[OverlapContribution], targets Dictionary[string, string]) {
            for item in items {
                try {
                    let pull = GitHub.Api("repos/" + repo + "/pulls/" + item.Number.ToString())
                    item.Facts["head_after"] = J.Text(J.Get(pull, "head"), "sha")
                    item.Facts["target_branch_after"] = J.Text(J.Get(pull, "base"), "ref")

                    if item.Identity == "" || Identity(pull) != item.Identity {
                        throw CliFailure("stale_approval", "Contribution identity changed during evidence collection")
                    }

                    if let binding = item.Binding {
                        let live = ReceiptVerification.Verify(repo, item.Number, paths: false)
                        let fields = "version,issue,approval,authority_revision,base,base_branch,commit,verified_target_revision"
                        let current = J.Write(J.Select(live.Element(), fields))
                        let original = J.Write(J.Select(binding.Element(), fields))

                        if current != original {
                            throw CliFailure(
                                "stale_approval",
                                "Contribution binding changed during evidence collection"
                            )
                        }
                    }

                    item.Stable = true
                    item.Facts["identity_status"] = "stable"
                } catch (error Exception) when error is CliFailure ||
                    error is JsonException ||
                    error is ApiDeadlineException ||
                    error.GetType() == typeof(Exception) {
                    Failure(item.Facts, "identity", error)
                    item.Facts["binding_status"] = "unknown"
                    item.Invalidate()
                }
            }

            for target in targets {
                var current string = ""
                try {
                    current = GitHub.Branch(repo, target.Key)
                } catch (error Exception) when error is CliFailure ||
                    error is JsonException ||
                    error is ApiDeadlineException ||
                    error.GetType() == typeof(Exception) { }

                for item in items {
                    if item.Target != target.Key {
                        continue
                    }

                    let stable = target.Value != "" && current == target.Value
                    item.Facts["target_status"] = stable ? "stable": "unknown"
                    item.Facts["target_revision_after"] = current

                    if !stable {
                        item.Facts[
                            "target_error"
                        ] = "Target evidence unavailable or changed during collection; owner review required."
                        item.Stable = false
                        item.Facts["identity_status"] = "unknown"
                        item.Invalidate()
                    }
                }
            }
        }

        internal func Run(args Args) {
            Remaining = 24000

            let repo = RepositoryIdentity.Repo(args.Need("repo"))
            let numbers = Overlaps.PullNumbers(args.Need("prs"))
            let items = List[OverlapContribution]()
            let targets = Dictionary[string, string](StringComparer.Ordinal)
            let changes = Dictionary[string, HashSet[string]](StringComparer.Ordinal)

            for number in numbers {
                let item = OverlapContribution(number)
                items.Add(item)
                Read(repo, item, targets, changes)
            }

            Recheck(repo, items, targets)

            let pairs = List[Object]()

            for i in 0 ... items.Count {
                for j in i + 1 ... items.Count {
                    let left = items[i]
                    let right = items[j]
                    let same = left.Target != "" && left.Target == right.Target
                    let paths = List[Object]()
                    var count int32
                    let known = same && left.Stable && right.Stable && left.Files != nil && right.Files != nil

                    if known {
                        let names = List[string](left.Files ?? HashSet[string]())
                        names.Sort(StringComparer.Ordinal)

                        for name in names {
                            if right.Files?.Contains(name) == true {
                                count++
                                Retain(paths, name)
                            }
                        }
                    }

                    let status = !left.Stable ||
                        !right.Stable ||
                        left.Target == "" ||
                        right.Target == "" ? "unknown": (
                        !same ? "different_targets": (
                            !known ? "unknown": (count > 0 ? "overlap": "no_filename_overlap")
                        )
                    )

                    pairs.Add(
                        map[string, Object?]{
                            "left_pr": left.Number,
                            "right_pr": right.Number,
                            "status": status,
                            "target_branch": same ? left.Target: "",
                            "paths": paths,
                            "overlap_count": known ? count as Object: nil,
                            "paths_output_complete": paths.Count == count
                        }
                    )
                }
            }

            let contributions = List[Object]()

            for item in items {
                contributions.Add(item.Facts)
                if item.Binding != nil {
                    Output.Sink.Actions.Add([]string{"tokate", "checks", repo + "#" + item.Number.ToString(), "--json"})
                }
            }

            let result = map[string, Object?]{
                "repo": repo,
                "contributions": contributions,
                "pairs": pairs,
                "advisory": Advisory
            }
            Output.Sink.ResultData = result
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
    }
}
