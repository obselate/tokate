package Tokate

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class GitHubPathEvidence {
    shared {
        private let CleanMergeParents Dictionary[string, List[string]] = Dictionary[string, List[string]]()

        internal func Ancestor(repo string, base string, fork string, head string) {
            RepositoryIdentity.Repo(repo)
            RepositoryIdentity.Repo(fork)
            RepositoryIdentity.CommitSha(base)
            RepositoryIdentity.CommitSha(head)
            let value = GitHub.Api("repos/" + repo + "/compare/" + base + "..." + fork.Split('/')[0] + ":" + head)
            if J.Text(J.Get(value, "base_commit"), "sha") != base || J.Text(
                J.Get(value, "merge_base_commit"),
                "sha"
            ) != base ||
                J
                .Get(value, "behind_by").ValueKind != JsonValueKind.Number || J.Number(value, "behind_by") != 0 ||
                (base == head ? J.Text(value, "status") != "identical": J.Text(value, "status") != "ahead") {
                throw CliFailure("invalid_state", "Missing or mismatched ancestry evidence")
            }
        }

        internal func Target(repo string, approval JsonElement, head string) {
            let approved = OwnerApproval.Record.Parse(approval)
            Ancestor(repo, approved.Base, repo, head)
            Ancestor(repo, head, repo, GitHub.Branch(repo, approved.BaseBranch))
            Decree.CheckCurrent(repo, head, approval)
        }

        internal func LocalBase(checkout string, repo string, approval JsonElement, head string, base string) string {
            var baseline = base
            for merge in Commands.Git(
                checkout,
                "rev-list",
                "--first-parent",
                "--merges",
                "--reverse",
                baseline + ".." + head
            )
                .Split('\n', StringSplitOptions.RemoveEmptyEntries) {
                let parents = Commands.Git(checkout, "rev-list", "--parents", "-n", "1", merge).Split(' ')
                if parents.Length != 3 {
                    throw CliFailure("invalid_state", "Amend requires two-parent target merges")
                }
                Target(repo, approval, parents[2])
                Ancestor(repo, baseline, repo, parents[2])
                baseline = parents[2]
            }
            return baseline
        }

        internal func Amendment(repo string, record JsonElement, metadata JsonElement) {
            let approval = J.Get(record, "approval")
            let baseline = J.Text(metadata, "base") == "" ? J.Text(record, "base"): J.Text(metadata, "base")
            if baseline != J.Text(record, "base") {
                Target(repo, approval, baseline)
                Ancestor(repo, baseline, J.Text(metadata, "fork"), J.Text(metadata, "head"))
            }
            Ancestor(repo, J.Text(metadata, "previous"), J.Text(metadata, "fork"), J.Text(metadata, "head"))
            Check(repo, J.Get(record, "policy"), approval, baseline, J.Text(metadata, "fork"), J.Text(metadata, "head"))
        }

        internal func CleanMerges(repo string, fork string, approval JsonElement, receipt string, head string) {
            let key = repo + "\n" + fork + "\n" + receipt + "\n" + head
            var cached List[string]
            if CleanMergeParents.TryGetValue(key, out cached) {
                for upstream in cached {
                    Target(repo, approval, upstream)
                }
                return
            }
            let targets = List[string]()
            let checkout = Path.Combine(Path.GetTempPath(), "tokate-checks-" + Guid.NewGuid().ToString("N"))
            Directory.CreateDirectory(checkout)
            try {
                Commands.Git(checkout, "init", "--quiet", "--bare")
                let fetched = Commands.GitResult(
                    checkout,
                    []string{
                        "fetch",
                        "--quiet",
                        "--filter=blob:none",
                        "--no-tags",
                        "--no-recurse-submodules",
                        "--",
                        "https://github.com/" + RepositoryIdentity.Repo(fork) + ".git",
                        RepositoryIdentity.CommitSha(head)
                    }
                )
                if fetched.Code != 0 {
                    throw CliFailure(
                        "evidence_pending",
                        "PR head is not yet available for verification. Wait for GitHub to expose the pushed head, then run tokate checks again."
                    )
                }
                if Commands.GitResult(
                    checkout,
                    []string{"merge-base", "--is-ancestor", RepositoryIdentity.CommitSha(receipt), head}
                )
                    .Code != 0 {
                    throw CliFailure("stale_approval", "Later PR commits need owner review and a verified amendment")
                }
                var previous = receipt
                for merge in Commands.Git(checkout, "rev-list", "--first-parent", "--reverse", receipt + ".." + head)
                    .Split('\n', StringSplitOptions.RemoveEmptyEntries) {
                    let parents = Commands.Git(checkout, "rev-list", "--parents", "-n", "1", merge).Split(' ')
                    if parents.Length != 3 || parents[1] != previous {
                        throw CliFailure(
                            "stale_approval",
                            "Later PR commits need owner review and a verified amendment"
                        )
                    }
                    Target(repo, approval, parents[2])
                    let tree = Commands.Git(checkout, "rev-parse", merge + "^{tree}")
                    if Commands.Git(checkout, "merge-tree", "--write-tree", previous, parents[2]) != tree ||
                        Commands.Git(checkout, "merge-tree", "--write-tree", receipt, parents[2]) != tree {
                        throw CliFailure(
                            "stale_approval",
                            "Later PR changes need owner review and a verified amendment"
                        )
                    }
                    targets.Add(parents[2])
                    previous = merge
                }
                if previous != head {
                    throw CliFailure("stale_approval", "PR head is not a clean target merge of the receipt head")
                }
            } finally {
                Directory.Delete(checkout, true)
            }
            CleanMergeParents[key] = targets
        }

        internal func Check(
            repo string,
            policy JsonElement,
            approval JsonElement,
            base string,
            fork string,
            head string
        ) {
            for path in Diff(repo, base, fork, head) {
                ProtectedPaths.Check(policy, approval, path)
            }
        }

        internal func Diff(repo string, base string, fork string, head string) HashSet[string] {
            RepositoryIdentity.Repo(repo)
            RepositoryIdentity.Repo(fork)
            RepositoryIdentity.CommitSha(base)
            RepositoryIdentity.CommitSha(head)

            let comparison = GitHub.Api("repos/" + repo + "/compare/" + base + "..." + fork.Split('/')[0] + ":" + head)
            let files = J.Get(comparison, "files")
            let commits = J.Items(J.Get(comparison, "commits"))

            if J.Text(comparison, "status") != "ahead" || J.Get(comparison, "behind_by")
                .ValueKind != JsonValueKind.Number ||
                J.Number(comparison, "behind_by") != 0 || J.Text(J.Get(comparison, "base_commit"), "sha") != base ||
                J.Text(J.Get(comparison, "merge_base_commit"), "sha") != base || commits.Count == 0 || J.Text(
                commits[commits.Count - 1],
                "sha"
            ) != head ||
                files.ValueKind != JsonValueKind.Array ||
                files.GetArrayLength() == 0 || files.GetArrayLength() >= 300 {
                throw Exception("Missing, truncated or mismatched approved-base-to-head diff evidence")
            }

            let filenames = HashSet[string](StringComparer.Ordinal)
            let endpoints = HashSet[string](StringComparer.Ordinal)

            for file in files.EnumerateArray() {
                let path = J.Text(file, "filename")
                ProtectedPaths.Relative(path)

                if !filenames.Add(path) {
                    throw Exception("Duplicate GitHub file diff evidence")
                }

                endpoints.Add(path)
                let status = J.Text(file, "status")

                if status != "added" &&
                    status != "removed" &&
                    status != "modified" &&
                    status != "renamed" &&
                    status != "changed" &&
                    status != "copied" {
                    throw Exception("Missing GitHub file diff status")
                }

                let previous = J.Get(file, "previous_filename")
                if status == "renamed" || previous.ValueKind != JsonValueKind.Undefined {
                    let name = J.Text(file, "previous_filename")
                    ProtectedPaths.Relative(name)
                    endpoints.Add(name)
                }
            }

            return endpoints
        }
    }
}
