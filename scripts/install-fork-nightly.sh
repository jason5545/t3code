#!/usr/bin/env bash
# Installs a build from build-fork-nightly.sh over the running Mac app, also from a thread inside it.
# Usage: scripts/install-fork-nightly.sh release/fork-nightly/<version>
# The swap runs in its own session so quitting T3 does not kill it; T3's restart continuation
# then resumes the calling turn. Progress goes to <version>/install.log.
set -euo pipefail
APP="/Applications/T3 Code (Nightly).app"
EXE="$APP/Contents/MacOS/T3 Code Jason (Nightly)"
# pgrep would read the parentheses in the path as a regex group.
t3_pids() { ps -axo pid=,comm= | while read -r pid comm; do [[ $comm == "$APP/"* ]] && echo "$pid"; done; }

if [[ "${1:-}" != --swap ]]; then
  out=$(cd "${1:?release directory}" && pwd)
  (cd "$out" && shasum -a 256 -c SHA256SUMS.txt >/dev/null)
  zip=$(ls "$out"/*-arm64.zip)
  stage="$out/stage"
  rm -rf "$stage" && mkdir -p "$stage" && ditto -x -k "$zip" "$stage"
  new=$(ls -d "$stage"/*.app)
  codesign --verify --deep --strict "$new"
  [[ $(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$new/Contents/Info.plist") == com.jason5545.t3code.nightly ]]
  main=""
  for pid in $(t3_pids); do
    [[ $(ps -o ppid= -p "$pid" | tr -d ' ') == 1 && $(ps -o comm= -p "$pid") == "$EXE" ]] && main=$pid
  done
  log="$out/install.log"
  : >"$log"
  perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' /bin/bash "$0" --swap "${main:-none}" "$new" "$log" </dev/null >/dev/null 2>&1 &
  echo "Swap started (main process ${main:-none}); log: $log"
  exit 0
fi

main=$2 new=$3 log=$4
exec >>"$log" 2>&1
say() { echo "$(date '+%H:%M:%S') $*"; }
# Lets the caller's tool call return before T3 quits.
sleep 5
if [[ $main != none ]]; then
  [[ $(ps -o comm= -p "$main") == "$EXE" ]] || { say "ABORT: $main is not $EXE"; exit 1; }
  kill -TERM "$main"
  say "TERM sent to $main"
fi
for _ in $(seq 1 60); do
  [[ -z $(t3_pids) ]] && break
  sleep 0.5
done
if [[ -n $(t3_pids) ]]; then
  say "ABORT: T3 still running after 30 s, bundle untouched"
  exit 1
fi
say "no T3 process left"
old="$(dirname "$new")/previous.app"
rm -rf "$old"
[[ -d $APP ]] && mv "$APP" "$old"
if ! ditto "$new" "$APP"; then
  say "copy failed, restoring the old bundle"
  rm -rf "$APP" && mv "$old" "$APP"
fi
codesign --verify --deep --strict "$APP" && say "installed: $(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
env -i HOME="$HOME" USER="$USER" PATH=/usr/bin:/bin:/usr/sbin:/sbin /usr/bin/open "$APP"
say "relaunched by path"
rm -rf "$old"
