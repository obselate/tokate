package Tokate

import System
import System.Text.Json

internal class RepositoryAccess {
    shared {
        internal func ValidateFork(repo string, forkRepo string, branch string, head string, actor int64) JsonElement {
            let fork = RepositoryIdentity.Repo(forkRepo)
            let info = GitHub.Api("repos/" + fork)

            RepositoryAccess.ValidateRepository(
                repo,
                fork,
                actor,
                info,
                push: false,
                upstream: GitHub.Api("repos/" + repo)
            )

            let reference = GitHub.Api("repos/" + fork + "/git/ref/heads/" + branch)
            if J.Text(J.Get(reference, "object"), "sha") != head {
                throw Exception(
                    "Fork branch does not point to the exact declared commit. Push it with: git push " +
                        GitHub.WebUrl +
                        fork +
                        ".git " +
                        head +
                        ":" +
                        GitHub.HeadsRefPrefix +
                        branch
                )
            }

            return info
        }

        internal func ValidateRun(run Data) {
            let repo = RepositoryIdentity.Repo(run.Repo)
            let head = RepositoryIdentity.Repo(run.HeadRepo)
            let upstream = GitHub.Api("repos/" + repo)
            let info = RepositoryIdentity.SameRepo(repo, head) ? upstream: GitHub.Api("repos/" + head)

            ValidateRepository(repo, head, run.DonorId, info, upstream: upstream)

            if (
                run.HasPreparationRepoId && RepositoryIdentity.PositiveId(run.PreparationRepoId) !=
                RepositoryIdentity.PositiveId(J.Get(upstream, "id"))
            ) ||
                (
                run.HasPreparationHeadId && RepositoryIdentity.PositiveId(run.PreparationHeadId) !=
                RepositoryIdentity.PositiveId(J.Get(info, "id"))
            ) {
                throw Exception("Saved contribution repository identity changed")
            }
        }

        internal func RequireOwner(repo string) JsonElement {
            let info = GitHub.Api("repos/" + repo)

            if !J.Bool(J.Get(info, "permissions"), "push") {
                throw Exception("Repository write permission is required")
            }

            return info
        }

        internal func ValidateRepository(
            repo string,
            head string,
            actor int64,
            info JsonElement,
            push bool = true,
            upstream JsonElement = default(JsonElement)
        ) {
            RepositoryIdentity.PositiveId(J.Get(info, "id"))
            if upstream.ValueKind != JsonValueKind.Undefined && !RepositoryIdentity.SameRepo(
                J.Text(upstream, "full_name"),
                repo
            ) {
                throw Exception("Selected upstream repository identity changed")
            }

            let owner = RepositoryIdentity.PositiveId(J.Get(J.Get(info, "owner"), "id"))
            if owner != RepositoryIdentity.PositiveId(actor) || !String.Equals(
                J.Text(info, "full_name"),
                head,
                StringComparison.OrdinalIgnoreCase
            ) ||
                (push && !J.Bool(J.Get(info, "permissions"), "push")) {
                throw Exception("Head repository must be writable and numerically owned by the authenticated donor")
            }

            if String.Equals(head, repo, StringComparison.OrdinalIgnoreCase) {
                return
            }

            let parent = J.Get(info, "parent")
            if !J.Bool(info, "fork") || !String.Equals(
                J.Text(parent, "full_name"),
                repo,
                StringComparison.OrdinalIgnoreCase
            ) ||
                (
                upstream.ValueKind != JsonValueKind.Undefined && RepositoryIdentity.PositiveId(
                    J.Get(parent, "id")
                ) != RepositoryIdentity.PositiveId(J.Get(upstream, "id"))
            ) {
                throw Exception("Head repository is not a fork of the selected upstream")
            }
        }
    }
}
