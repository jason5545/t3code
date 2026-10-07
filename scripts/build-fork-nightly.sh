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
node24=$(pnpm dlx node@24 -p 'process.execPath')
export PATH="$(dirname "$node24"):$PWD/node_modules/.bin:$PATH"
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
printf 'VERSION=%s\nSOURCE_COMMIT=%s\nARCH=%s\nSIGNING=Apple Development (not notarized)\nUPDATE_REPOSITORY=jason5545/t3code\n' "$T3CODE_DESKTOP_VERSION" "$(git rev-parse HEAD)" "$arch" > "$out/build-provenance.txt"
(cd "$out" && shasum -a 256 *.dmg *.zip *.blockmap *.yml build-provenance.txt > SHA256SUMS.txt)
printf 'Build ready for verification: %s\n' "$PWD/$out"
