# Public content audit: 2026-10-02

This is a bounded audit of public content, with outstanding coverage gaps. It is
not a completed audit or a guarantee that secrets are absent. No real credential
was identified by the checks described below. Scanner results contained only
categories, locations and counts; candidate values and surrounding text were not
printed. No credential was used to test whether it works.

## Coverage and evidence

The public upstream was `obselate/tokate`, main commit
`22c3c80e77a526802488c84d4dccc0e489ed86e6`. Requests used anonymous HTTPS without
GitHub CLI authentication or donor credential storage. The API inventories were
not truncated and had no remaining pagination at the time of inspection.

| Surface | Actual review | Limits |
| --- | --- | --- |
| Current repository | 95 files from the public recursive tree, matched to checkout paths; credential/path/output signatures; manual review of documentation, installer, subprocess, report/patch publishing, packaging and workflow boundaries | Local Git metadata is denied in this task, so this inventory does not prove the local index matches upstream; not every source line received manual review |
| Main history | All 57 commit messages and their author/committer contact metadata, plus 56 public commit patches, back to `cdd92e51c1b970ac07cfe432eace3fdc03307f27` | Patch for `aeb83a226826e8758245bb14f26271162b62b986` returned HTTP 403; patch views do not establish coverage of historical binary contents, omitted diffs, deleted refs or other branches/forks |
| Published website | Downloaded all 49 paths represented by `site/`; each was byte-identical to the checkout by SHA-256 comparison | No directory listing or exhaustive discovery of unlinked URLs, old deployments, caches or CDN retention |
| Assets and metadata | Current PNG ancillary chunks, JPEG application segments, WebP EXIF/XMP chunks, SVG/text references and six TTF plus six decompressed WOFF2 name tables; visual review of the social card | No OCR of every image, steganography analysis or complete forensic parsing of every font/image format; compressed binary substring matches alone are not evidence of an email disclosure |
| Source maps and private URL probes | No source-map references/signatures in reviewed content; `app.js.map`, `style.css.map`, `.env` and `.git/config` on the published site returned HTTP 404 | Four negative probes do not establish that all private-looking URLs are absent |
| Releases | Descriptions and every asset of v0.2.2, v0.2.3 and v0.2.4; downloaded three tarballs and three checksums, inspected 11/13/13 archive members including binary strings, and verified all checksums | Did not execute downloaded binaries; not a complete binary forensic analysis, proof of build provenance or inventory of previously deleted releases |
| Issues and PRs | All 33 open/closed issue entries (including PR #33), titles/bodies, PR #33's public diff and review inventory | Zero issue comments, inline review comments or submitted reviews were returned; deleted/edited prior revisions and inaccessible material are not covered |
| Attachments | Checked conversation bodies for GitHub attachment/user-image/legacy repository file links and embedded image/video markers; none were present | No attachment download was applicable; arbitrary external links were not recursively crawled |
| Actions and deployment output | Indexed 76 workflow runs and 30 unexpired `github-pages` artifacts; inspected current workflow source, latest completed CI/Website job metadata and both public annotations on the only failed run (`36999288625`) | CI and Website log downloads returned HTTP 403; the Pages artifact download returned HTTP 401. Raw logs and the uploaded Pages tar payload were **not inspected**; the actual served site was inspected separately |

The scan looked for GitHub/API/AWS credential shapes, private-key headers,
credential assignments, user-specific home paths and source-map content. A
separate email inventory of repository files found required third-party attribution
and synthetic test identities. Those are retained. Commit metadata also contained
potential contact disclosures requiring owner review, described below. The current
artwork did not have PNG text,
JPEG EXIF/XMP or WebP EXIF/XMP chunks detected by the chunk inspection. Font names
and license metadata are necessary attribution, not evidence of a credential.
Heuristics can miss arbitrary secrets, encoded/compressed payloads and personal
details that require human context. A zero candidate count is not proof of safety.

Private local environment files, donor home directories, authentication stores,
mixed private configuration and pre-existing scratch contents were excluded.
Only this audit's newly generated public inventory and redacted summaries were
read from its scratch subdirectory. No history rewrite, publication, external
issue creation or contact with another person was performed.

## Findings and prevention

1. All 57 main-history author records and 56 of 57 committer records contained
   routable non-noreply email attribution; the remaining committer used GitHub
   noreply attribution. Values are deliberately withheld. This is a potential
   contact privacy disclosure, not an identified credential. Its presence does
   not establish that it was unintended: the owner must decide whether these
   contacts are meant to be public. The latest affected author metadata is at
   `22c3c80e77a526802488c84d4dccc0e489ed86e6`. Review future repository commit identity
   against the account's GitHub noreply setting. No identity configuration or
   historical attribution was changed; any rewrite needs separate concrete review.
2. `.tokate-scratch/` was not ignored although `Worker.gs` creates a scratch home
   inside the checkout and later stages with `git add -A`. This creates a path for
   machine-specific runtime files to enter a contribution. Ignore rules now cover
   scratch directories, common local configuration/authentication filenames,
   environment files, private keys, certificates, logs, dumps and source maps.
   Ignoring a file does not untrack an existing file or stop `git add -f`.
3. Pages uploads the whole `site/` directory. A checked-in publication inventory
   and guard now reject extra or missing website files, symlinks, recognized
   sensitive text and image text/location metadata. The guard runs in the existing
   `verify` check. **The separate Pages workflow still uploads directly and does
   not depend on that check.** An owner must wire the guard before upload; this
   donor task cannot change protected workflows. See the focused issue draft.
4. Release packaging recursively copied `docs/` and `licenses/` and reused a
   staging directory. It now scans approved inputs and the executable, copies only
   explicit document paths into a fresh temporary bundle and removes that staging
   directory after packaging. Unlisted local documentation and stale bundle files
   cannot be included by that copy path. Website inventory changes and release
   document additions require review of `scripts/publication-files.json`.
5. Host environment inheritance, persistent raw logs and report/patch publication
   remain as described in [transparency.md](transparency.md). This repository's
   guard is not a general Tokate runtime scrubber. Runtime fixes belong to
   [#17](https://github.com/obselate/tokate/issues/17), not this audit.

## Reproducing the prevention checks

Development and packaging require Node.js as well as the existing .NET toolchain.
Run `node --test tests/public-content.test.mjs` and
`node scripts/check-public-content.mjs` in a normal checkout. The guard uses
`git ls-files -z` for tracked content and separately inventories the actual website
directory, including untracked/hidden entries. It rejects private filenames before
reading their contents. Scanner findings use a SHA-256 prefix of the relative path,
a category and an optional line number; neither arbitrary filenames nor matching
values are echoed. Match the first 16 hex characters of a relative path's SHA-256
to locate a finding locally without publishing that path.

In a task with Git metadata denied, `--files-from FILE` accepts a JSON array from a
public tree plus explicitly added implementation files. This checks that supplied
inventory only and cannot replace an independent tracked-file check. Missing
tools, inaccessible files, symlinks and scanner errors fail the guard; they are
not reported as a pass. See the task's final report for actual verification
commands and results in the restricted checkout.

The synthetic tests cover detection and redacted output, rejection before opening
private filenames, root/nested ignore rules in an isolated fixture repository,
hidden/extra website files, symlink/traversal boundaries, image metadata and the
actual packaging command's clean staging. They use no real credentials or donor
authentication files. The Node guard checks binary strings but does not decompress
font payloads or provide a general secret scrubber.

## Verification in this checkout

All commands below completed with exit code 0. The .NET commands used a fresh
audit-only CLI home/package cache and disabled telemetry/certificate generation;
build output was redacted before printing machine paths. The supplied file
inventory contained the 95 public-tree paths plus the five newly added
implementation/documentation files (100 paths total).

| Command | Actual result |
| --- | --- |
| `node --test tests/public-content.test.mjs` | 8 tests passed, 0 failed; includes the actual package script with synthetic inputs |
| `node scripts/check-public-content.mjs --files-from .tokate-scratch/public-audit/verification-files.json` | Passed the supplied content inventory and actual website boundary |
| `node scripts/check-public-content.mjs --stage-release .tokate-scratch/public-audit/release-stage` | Passed scanning the newly built executable and staging approved release documents |
| `node --check site/app.js` | Passed |
| `node --check scripts/check-public-content.mjs` and `node --check tests/public-content.test.mjs` | Both passed |
| `sh -n site/install.sh` | Passed |
| `bash -n scripts/package.sh scripts/verify.sh` | Passed |
| `dotnet restore Tokate.gsproj --locked-mode --nologo` | Passed |
| `dotnet "$NUGET_PACKAGES/gsharp.net.sdk/0.4.591/tools/formatter/gsfmt.dll" --check src tests` | Passed |
| `dotnet build Tokate.gsproj -c Release --no-restore --nologo -warnaserror` | Passed, 0 warnings and 0 errors |
| `dotnet publish Tokate.gsproj -c Release --no-restore -o artifacts/linux-x64 --nologo -warnaserror` | Passed NativeAOT publication |
| `dotnet restore tests/Tokate.Tests.gsproj --locked-mode --nologo` | Passed |
| `dotnet publish tests/Tokate.Tests.gsproj -c Release --no-restore -o artifacts/tests --nologo -warnaserror` | Passed |
| `artifacts/tests/tokate-tests` | 21 PASS entries, exit 0 |
| `artifacts/linux-x64/tokate --version` | `tokate 0.2.4`, exit 0 |

The full `scripts/verify.sh`, default tracked-index guard and `git diff --check`
were not run against this checkout because this agent is prohibited from reading
its `.git`. The permitted components were run separately; an independent full
verification is still required in a context with authorized metadata access.
The real package command was exercised in a synthetic fixture, not run against
this checkout's denied Git metadata. Public HTTP failures are recorded in the
coverage table above; no inaccessible log/artifact is counted as inspected.

## Outstanding actions and incident handling

[Focused issue drafts](audit-follow-ups.md) describe contact metadata review, the
protected Pages gate and the remaining authenticated audit. They are drafts in this checkout; posting is
outside this task's authorization. Issue #3 should not be treated as a fully
completed audit while workflow logs, uploaded artifacts and the history gap remain.

If a real credential is later found, stop public disclosure of values. Record only
the surface/category in public. Arrange owner/provider revocation or rotation and
removal through an approved private channel, then assess history, logs, artifacts,
caches and forks. Deleting the latest file is insufficient. No private contact was
needed here because no real credential was identified; no contact is authorized
by this task. Any proposed history rewrite needs a separate concrete review of
affected refs, collaborators, retained copies and recovery before execution.
