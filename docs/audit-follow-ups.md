# Focused audit follow-up issue drafts

These drafts are ready for owner review. They have not been posted to GitHub.
Runtime environment and report/output changes remain with
[#17](https://github.com/obselate/tokate/issues/17).

## Review public commit contact metadata and future identity settings

**Problem:** All 57 author records and 56 committer records in reviewed main
history contained routable non-noreply email attribution. The audit withholds
addresses and does not determine whether the owner intended them to be public.

**Scope:** Owner review of public attribution and future repository commit
identity. Tokate's donor publication already sets GitHub noreply attribution;
changing general runtime publication stays with #17. No blanket identity policy,
global Git configuration change or history rewrite is authorized by this draft.

**Acceptance criteria:**

- Decide whether the existing contact metadata is intentional without repeating
  addresses in public discussion.
- If it is unintended, configure and verify a public-safe identity for future
  maintainer commits using the account's GitHub noreply address.
- Document a synthetic commit-metadata check without using personal contact data.
- Propose any desired historical remediation separately, with affected refs,
  retained copies, coordination and recovery reviewed before a rewrite.

**Verification:** Inspect author/committer metadata of a synthetic commit and the
next real maintainer commit; report categories rather than contact values.

## Gate Pages uploads on the public-content inventory

**Problem:** `.github/workflows/pages.yml` uploads the entire `site/` tree and can
deploy independently of the repository `verify` job. The new public-content guard
therefore does not yet prevent that direct publication path.

**Scope:** An owner-approved change to the protected Pages workflow. Keep the
existing read-only build, draft fork PR validation, stable job name and restricted
deploy permissions.

**Acceptance criteria:**

- Run the synthetic prevention tests and public-content guard before uploading
  Pages content, with missing tools and scanner errors failing the build.
- Trigger validation when the guard, publication inventory or tests change, as
  well as when `site/` changes.
- Fail before upload for a synthetic hidden environment file, diagnostic file,
  unapproved asset, source map, symlink or metadata fixture; do not print its value.
- Upload only reviewed website paths and inspect the produced artifact inventory.
- Demonstrate that a failed guard prevents deployment. Use no repository secrets
  while validating contributor code.

**Verification:** Run synthetic failure/pass cases and inspect the actual Pages
artifact and workflow dependency graph before accepting the change.

## Finish inaccessible public history, Actions logs and artifact coverage

**Problem:** The anonymous audit could inspect the served website but could not
download raw workflow logs, the Pages upload or one main-history patch.

**Scope:** An owner performs a read-only audit using their normal authorized GitHub
access outside the donor task. Read public material only; do not retrieve donor
credentials or private configuration. This is a follow-up maintenance task, not
permission to rewrite history or rerun a donor contribution.

**Acceptance criteria:**

- Review commit `aeb83a226826e8758245bb14f26271162b62b986` and historical assets/diffs
  omitted by public patch views; record exact refs and file coverage.
- Download available public CI and Website logs and Pages artifact payloads;
  record run/artifact IDs, retention gaps and redacted findings.
- Reconcile archive inventories with the served site and release boundaries.
- Include relevant old deployments and edited conversation/attachment material
  where recoverable, without claiming coverage of deleted or inaccessible data.
- Use category/location-only findings. If a real credential is found, coordinate
  private revocation/rotation before public cleanup discussion, and propose any
  history rewrite separately for concrete review.
- Update `docs/public-content-audit.md` with evidence and remaining gaps; do not
  replace limitations with an absolute absence-of-secrets claim.

**Verification:** Inspect actual downloaded material with a redacted scanner and
focused human review. Synthetic fixtures verify scanner output and incident
handling; never test a suspected credential by using it.
