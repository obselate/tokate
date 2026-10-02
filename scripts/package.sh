#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/check-public-content.mjs
version=$(dotnet msbuild Tokate.gsproj -getProperty:Version -nologo)
test "$(artifacts/linux-x64/tokate --version)" = "tokate $version"
bundle="tokate-$version-linux-x64"
stage=$(mktemp -d artifacts/package.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
node scripts/check-public-content.mjs --stage-release "$stage/$bundle"
install -m 755 artifacts/linux-x64/tokate "$stage/$bundle/tokate"
tar -czf "artifacts/$bundle.tar.gz" -C "$stage" "$bundle"
(cd artifacts && sha256sum "$bundle.tar.gz" > "$bundle.tar.gz.sha256")
