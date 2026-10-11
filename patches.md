# Fork patches

Repository: https://github.com/jason5545/t3code
Upstream baseline: `c1d528a342ef14fa960a8cc6283d6324b4488f5c` (merged 2026-10-12).

## 1. OMP provider

- OMP is an independent provider instance with display name `OMP` and executable `omp`.
- It shares the Pi driver, without overwriting a user's existing Pi configuration.
- New/legacy settings that omit `providerInstances` receive the OMP default. Explicit instance maps, including an empty map, remain unchanged. Existing users can add OMP in Settings → Providers.
- Sparse settings persistence compares `providerInstances` as a whole. Per-field stripping would drop a user-added OMP identical to the default, and turn removing it into an omitted key that restores the default.
- The creation wizard offers Pi and OMP separately, with independent drafts.
- OMP shows its own π mark and gradient from omp.sh instead of Pi's glyph. Instances share the `pi` driver, so `providerIconKind` treats a Pi instance whose name starts with "OMP" as OMP; web and mobile icons use it. Mobile surfaces that only know the driver (usage, environment provider lists) still show Pi. Web provider update prompts (toast, sidebar pill, Update all summary) also group and name by `providerIconKind`, so OMP updates are labelled OMP and do not collapse into Pi's.
- OMP JSONL dialect adapts command discovery, correlated prompt admission/completion, background settlement, queue state, and before-user branch semantics. Pi remains a passthrough.
- The T3 MCP extension's `$skill` input hook reads the skill file from `sourceInfo.path` (Pi) or `path` (OMP `getCommands()`), and skips a skill command with neither. Reading only `sourceInfo.path` threw on OMP, reported as `pi-t3-mcp-extension failed during input`, whenever a message carried a selected skill chip. OMP `18.7.0` and `18.8.7` share this shape.
- A completed Pi/OMP discovery probe (ready and authenticated) replaces the cached model list, like ACP Registry. The registry used to merge every Pi snapshot with the previous one, so models deleted from a local server (oMLX) stayed in the picker forever through the provider status cache; failed or readiness-only probes still keep the previous models (`shouldRetainMissingProviderModels` in `apps/server/src/provider/ProviderRegistry.ts`).
- The context window meter (Settings → General → Legacy features, off by default upstream) works for Pi/OMP in two more cases. Stop always terminates the Pi/OMP process, and finalizing after termination skipped `get_session_stats`, so every stopped turn lost its usage and a thread whose turns were all stopped never showed the meter. Stop now reads the stats right after the session-tree refs, before terminating, and skips the read when the refs read already failed, so a hung process does not wait twice. OMP's `message_update` carries cumulative usage only on `message.usage`, while the adapter reads Pi's top-level `usage` (Pi `0.84.2`+), so the meter never moved during an OMP turn; the OMP dialect now lifts it. OMP `18.8.9`'s Anthropic stream sets usage at `message_start`; providers that report usage only at response end move the meter once per assistant message. The lift was checked against the installed binary, not a recorded live stream.
- OMP's `todo` tool shows as the thread's todo list, like Claude's TodoWrite. A successful call reports every phase in `result.details.phases`; the Pi adapter mirrors it into the turn's `todo_list` plan (`ompTodoSteps` in `packages/provider-pi/src/server/rpcDialect.ts`). A `view` call or a failed call leaves the list alone. `in_progress` runs, `completed` and `abandoned` are done, `pending` and `blocked` wait, and tasks carry their phase name when there is more than one phase. Pi has no todo tool, so nothing changes there. Shape checked against OMP `18.9.2` source.
- Thinking streams live for models that think in one unbroken paragraph. Paragraph streaming (the default `responseStreamingMode`) held reasoning until a blank line, list item or closing fence, so the local models behind OMP showed no thought until it ended, even though the Pi adapter received every `thinking_delta`. `apps/server/src/orchestration-v2/assistantStreaming.ts` now passes reasoning's whole text on the existing 400ms throttle for every provider; assistant text keeps paragraph buffering, and `turn` mode still streams nothing.
- Compatible protocol was inspected from installed OMP `18.7.0`; tests cover these adaptations. No model-generation request was used during verification.

## 2. Taiwan Traditional Chinese interface

- Adds `en` and `zh-TW`, a saved device-local language selection, Traditional Chinese browser defaults and English fallback. The General and Appearance settings contain the language selector; changing it reloads the page.
- Most text is translated at build time so component sources stay identical to upstream. `scripts/i18n/autoTranslate.cjs` runs in the web Vite Babel pass and the mobile Babel config. It rewrites English in display positions (JSX text, display attributes and object properties, toast and `Alert.alert` calls, and toast button labels under `actionProps`/`secondaryActionProps` even when a helper such as `stackedThreadToast` builds them) into runtime calls carrying both languages, but only for strings in `apps/web/src/locale/zh-TW.json`. Variables and default parameters whose names end in `Label`, `Placeholder` or `Tooltip` (`footerActionLabel`, `escapeLabel = "Close"`) are display text in every file, except the agent-facing context-record names below. So are the string values of lookup tables named like `SORT_ORDER_LABELS`, `toolbarTitles` or `MODE_DESCRIPTIONS`, which feed most menu and select options. Helpers whose name ends in `Label`, `Title`, `Placeholder`, `Tooltip` or `Description` (`resolveEnvModeLabel`) return display text, including their local variables; components with such names are excluded. Helpers that build agent context or stored titles (review range labels, plan thread titles, pending-task draft titles) and key names stay English through `untranslated.json`. Mobile follows the device language.
- Files listed in `scripts/i18n/displayFiles.json` build display copy in helpers (provider status summaries, banner titles, update notices). There, returned values, variable initializers, array elements and `detail`/`message`/`reason`/`body`/`text` properties are translated too. Add a file there when its helper text stays English.
- The Scratch project's title is server data (`No project`); web and mobile relabel it through `createLocalizedEnvironmentSnapshotAtom` in client-runtime. Known server provider status and provider update messages (for example `Checking OMP CLI availability...`, `Update command exited with code 1.`) are matched by `packages/client-runtime/src/providerStatusMessages.ts`; web and mobile display them through their own `locale/serverMessages.ts`. Model option labels from the server (reasoning effort, speed, thinking, such as `Extra High`) go through `localizeProviderOptionLabel` at display time only, because client code still compares English labels like `Fast`. Other server-generated text stays English.
- Inline JSX children become one message (`Delete {name} from {project}?`), so translations can reorder values or drop English plural suffixes.
- `scripts/i18n/untranslated.json` keeps names and identifiers English, and keeps English at positions where code compares the literal (for example the `New thread` draft title, which the server checks). The iOS Live Activity (`apps/mobile/src/widgets/AgentActivity.tsx`) runs its `"widget"` function in a separate JavaScript context without the translation runtime, so text added there stays English. Context-record fields that reach agents (`rangeLabel`, `sectionTitle`, `terminalLabel`) are never translated.
- The first-round `t()` calls and typed `messages.ts` catalog remain for the files they already touch.
- After syncing upstream, run `node scripts/i18n/extract.ts --json <file>` to list new untranslated text, add it to the catalog, and check new comparisons against display strings. Restart Metro with `--clear` after catalog edits.
- User content, code, paths, provider/model names and server-generated messages are not translated. Electron's custom native menu labels remain English.
- Desktop packaging retains both Chromium `zh-TW.pak` (Windows/Linux) and `zh_TW.lproj` (macOS). Electron Builder compares locale basenames literally, so both separator spellings are listed. The initial unpublished build exposed this mismatch; it was corrected before local installation.

## Development-signed fork nightly

- Local builds use an existing Apple Development identity in the owner's macOS keychain. No private key is exported, committed or uploaded to GitHub.
- Opt-in `T3CODE_MACOS_SIGNING_MODE=development` requires this fork's update repository, a nightly version, `--signed`, and a valid certificate SHA-1 identity.
- A dedicated signing hook checks that identity is Apple Development and verifies the complete signed bundle.
- Product name: `T3 Code Jason (Nightly)`; bundle ID: `com.jason5545.t3code.nightly`.
- Updates point only at `jason5545/t3code`, never the upstream release feed.
- No Apple notarization or upstream Associated Domains entitlement is claimed. This is a development build, not a Developer ID distribution. Gatekeeper and automatic installation may reject it; manual installation may be required.
- Standard distribution signing is unchanged and still requires the upstream provisioning configuration.
- Local native macOS architecture is built; other platforms/architectures are not implied.

## Verification

Run focused provider/protocol, contract/settings, locale/UI and packaging/signing tests, followed by web/server typechecks. Install only after artifact signature and bundled fork update feed verification. The current delivery is local Mac installation plus source push, not a GitHub release.

## Repeatable build

On the owner's Mac, from a clean committed fork checkout:

```sh
bash scripts/build-fork-nightly.sh
```

The script selects the single Apple Development identity in the keychain, uses Node 24, produces native-architecture DMG/ZIP and the nightly update manifest, and writes provenance/checksums. Set `T3CODE_MACOS_DEVELOPMENT_IDENTITY` explicitly if multiple development identities exist. It builds only; publication remains a separate action.

## Pre-release checks (2026-10-07)

- Focused server/provider/RPC regressions: 80 passed.
- Settings/provider contracts: 206 passed.
- Locale/search/chat-control regressions: 196 passed.
- Provider creation presets: 2 passed.
- Packaging/development-signing regressions: 89 passed.
- Web, server, contracts and desktop typechecks passed; signing-hook typecheck passed.
- Installed OMP metadata RPC smoke passed for state, command catalog and model catalog in a temporary HOME, with no model-generation request.
- Apple Development keychain identity successfully signed and verified a temporary executable. Final app signature must also be verified before publication.

## Local Mac deployment (2026-10-12)

- Owner instruction: do not publish a GitHub release; replace the existing Mac installation and push source to this fork.
- Installed `0.0.45-nightly.20261011.1791761398` at `/Applications/T3 Code (Nightly).app`, retaining the existing bundle path. It includes the upstream sync to `c1d528a342`, OMP todo lists, live streaming of unbroken thinking, and translations for the interface text the sync added (327 strings, mostly mobile pull request browsing and review guides).
- Installed binary was built from `11153a8fcb` and signed with the owner's existing Apple Development certificate; checksums, bundle ID, the bundled fork update feed and complete bundle verification passed after installation.
- `ProviderRegistry.test.ts` has three Codex/Cursor probe cases that time out on the owner's Mac. They time out the same way with upstream's `ProviderRegistry.ts`, so the fork's Pi model-retention change does not cause them.
- Quit the app and confirm its process is gone before replacing the bundle. `pgrep -f` treats the parentheses in `T3 Code (Nightly)` as a regex group, so match a plain substring such as `T3 Code`; otherwise the wait returns at once and a relaunch can hand off to the instance that is still quitting.
- Every deployment replaces the app bundle in place and keeps no copy of the old app, because any build can be reproduced from its source commit. After installing, delete superseded builds under `release/fork-nightly/` and keep only the installed one. No existing user profile is overwritten or manually migrated. Local user paths are not part of this public documentation.
- Source and `patches.md` are pushed to `jason5545/t3code`, branch `main`. Private profile backups are kept outside the repository; DMG/ZIP and local logs remain ignored and are not pushed.
- No release or release tag is created for this deployment.
