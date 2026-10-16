#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if git grep -nE '^[[:space:]]*//([^/]|$)' -- '*.gs'; then
    echo 'Code comments are not allowed.' >&2
    exit 1
fi
if git grep -lE '(ghp_|github_pat_|gho_|sk-ant-|sk-proj-)[A-Za-z0-9_]{10,}'; then
    echo 'A tracked file contains a secret-shaped token.' >&2
    exit 1
fi
if git grep -nP '(?<![\w.])(?<!func )\b(Terminal|DonationView|WizardScreen|TerminalProgress|PublicOutput|Cli|CliOption|CliCommand|CliOutput|CleanCommand|Completion|Donate|DonorDefaults|DonorSelection|Gratis|GratisGuidance|Installation|MachineSetup|OwnerHealth|OwnerSetup|Positionals|RepositoryInput|RunReference|Startup)\s*[.(]|\bConsole\.(?!CancelKeyPress\b)' -- 'src/*.gs' ':(exclude)src/Cli/**'; then
    echo 'CLI types are not allowed outside src/Cli.' >&2
    exit 1
fi
bash scripts/build.sh
runtime="${TOKATE_RUNTIME_IDENTIFIER:-linux-x64}"
tests=artifacts/tests/tokate-tests
if [[ "$runtime" == linux-musl-x64 ]]; then
    tests=artifacts/tests-musl/tokate-tests
fi
export TOKATE_BINARY="${TOKATE_BINARY:-$PWD/artifacts/$runtime/tokate}"
if [[ "${1:-}" == --full ]]; then
    test "$#" -eq 1
    env -u TOKATE_CI_SHARD "$tests"
    python3 scripts/native-proof.py
elif [[ "$#" -gt 0 ]]; then
    report=$(mktemp)
    trap 'rm -f "$report"' EXIT
    env -u TOKATE_CI_SHARD "$tests" "$@" | tee "$report"
    if ! grep -q '^PASS ' "$report"; then
        echo 'No test matched the selected arguments.' >&2
        exit 1
    fi
else
    selectors=(
        '--flow CrossAccountFlow'
        '--claude-smoke'
        '--omp-smoke'
        '--pi-smoke'
        '--coordination CanonicalSubmit'
        '--coordination RepositoryDonation'
        '--flow VerificationNetwork'
        '--protected-paths'
        '--coordination ReceiptEvidence'
        '--coordination CoordinatorPermissions'
        '--coordination LabelApprovalPermissions'
        '--coordination LeaseFencing'
        '--coordination PublicationRevocation'
        '--preparation ClaimRecovery'
        '--correction ProtectedAndExact'
        '--amendments ReceiptAuthority'
        '--continuation ImportBoundary'
    )
    reports=$(mktemp -d)
    trap 'rm -rf "$reports"' EXIT
    pids=()
    for i in "${!selectors[@]}"; do
        read -r -a args <<< "${selectors[$i]}"
        env -u TOKATE_CI_SHARD "$tests" "${args[@]}" > "$reports/$i" 2>&1 &
        pids+=("$!")
    done
    failed=0
    for i in "${!selectors[@]}"; do
        if wait "${pids[$i]}"; then
            echo "PASS ${selectors[$i]}"
        else
            echo "FAIL ${selectors[$i]}" >&2
            cat "$reports/$i" >&2
            failed=1
        fi
    done
    test "$failed" -eq 0
fi
"$TOKATE_BINARY" --version
git diff --check
