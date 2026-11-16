#!/usr/bin/env bash
# Build only. Publishing is a separate explicit operator action.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then echo "This build requires macOS." >&2; exit 1; fi
if [[ -n "$(git status --porcelain)" ]]; then echo "Commit the intended changes before building." >&2; exit 1; fi
origin=$(git remote get-url origin)
case "$origin" in
  https://github.com/jason5545/t3code.git|git@github.com:jason5545/t3code.git) ;;
  *) echo "Refusing to build for an unexpected origin." >&2; exit 1 ;;
esac
# Upstream pins the Node it builds with in the root package.json's engines, which CI reads.
# The node on PATH is used when it is that major; T3CODE_BUILD_NODE names another executable.
build_node=${T3CODE_BUILD_NODE:-$(command -v node)}
pinned=$("$build_node" -p 'require("./package.json").engines.node')
running=$("$build_node" -p 'process.versions.node')
if [[ "${running%%.*}" != "$(printf '%s' "$pinned" | grep -o '[0-9]*' | head -1)" ]]; then
  echo "Node $running ($build_node) is not the Node this repo builds with ($pinned). Install that major or set T3CODE_BUILD_NODE." >&2; exit 1
fi
echo "Building with Node $running (pinned: $pinned)"
export PATH="$(dirname "$build_node"):$PWD/node_modules/.bin:$PATH"
base=$(node -p 'JSON.parse(require("node:fs").readFileSync("apps/server/package.json","utf8")).version.split("-")[0]')
export T3CODE_DESKTOP_VERSION="${T3CODE_DESKTOP_VERSION:-$base-nightly.$(date -u +%Y%m%d).$(date +%s)}"
export T3CODE_MACOS_SIGNING_MODE=development
export T3CODE_DESKTOP_UPDATE_REPOSITORY=jason5545/t3code
if [[ -z "${T3CODE_MACOS_DEVELOPMENT_IDENTITY:-}" ]]; then
  identities=$(security find-identity -v -p codesigning | awk '/"Apple Development:/ {print $2}')
  if [[ $(printf '%s\n' "$identities" | grep -c .) != 1 ]]; then
    echo "Set T3CODE_MACOS_DEVELOPMENT_IDENTITY to one valid Apple Development certificate SHA-1." >&2; exit 1
  fi
  export T3CODE_MACOS_DEVELOPMENT_IDENTITY="$identities"
fi
arch=$(node -p process.arch)
out="release/fork-nightly/$T3CODE_DESKTOP_VERSION"
mkdir -p "$out"
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch "$arch" --signed --verbose --keep-stage --build-version "$T3CODE_DESKTOP_VERSION" --output-dir "$out"
printf 'VERSION=%s\nSOURCE_COMMIT=%s\nARCH=%s\nNODE=%s\nSIGNING=Apple Development (not notarized)\nUPDATE_REPOSITORY=jason5545/t3code\n' "$T3CODE_DESKTOP_VERSION" "$(git rev-parse HEAD)" "$arch" "$running" > "$out/build-provenance.txt"
(cd "$out" && shasum -a 256 *.dmg *.zip *.blockmap *.yml build-provenance.txt > SHA256SUMS.txt)
printf 'Build ready for verification: %s\n' "$PWD/$out"
