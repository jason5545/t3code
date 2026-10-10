# Fork patches

Repository: https://github.com/jason5545/t3code
Upstream baseline: `bd2346eda2e2c380d1844869c7fd16c279d2190f`.

## 1. OMP provider

- OMP is an independent provider instance with display name `OMP` and executable `omp`.
- It shares the Pi driver, without overwriting a user's existing Pi configuration.
- New/legacy settings that omit `providerInstances` receive the OMP default. Explicit instance maps, including an empty map, remain unchanged. Existing users can add OMP in Settings → Providers.
- Sparse settings persistence compares `providerInstances` as a whole. Per-field stripping would drop a user-added OMP identical to the default, and turn removing it into an omitted key that restores the default.
- The creation wizard offers Pi and OMP separately, with independent drafts.
- OMP shows its own π mark and gradient from omp.sh instead of Pi's glyph. Instances share the `pi` driver, so `providerIconKind` treats a Pi instance whose name starts with "OMP" as OMP; web and mobile icons use it. Mobile surfaces that only know the driver (usage, environment provider lists) still show Pi. Web provider update prompts (toast, sidebar pill, Update all summary) also group and name by `providerIconKind`, so OMP updates are labelled OMP and do not collapse into Pi's.
- OMP JSONL dialect adapts command discovery, correlated prompt admission/completion, background settlement, queue state, and before-user branch semantics. Pi remains a passthrough.
- Compatible protocol was inspected from installed OMP `18.7.0`; tests cover these adaptations. No model-generation request was used during verification.

## 2. Taiwan Traditional Chinese interface

- Adds `en` and `zh-TW`, a saved device-local language selection, Traditional Chinese browser defaults and English fallback. The General and Appearance settings contain the language selector; changing it reloads the page.
- Most text is translated at build time so component sources stay identical to upstream. `scripts/i18n/autoTranslate.cjs` runs in the web Vite Babel pass and the mobile Babel config. It rewrites English in display positions (JSX text, display attributes and object properties, toast and `Alert.alert` calls, and toast button labels under `actionProps`/`secondaryActionProps` even when a helper such as `stackedThreadToast` builds them) into runtime calls carrying both languages, but only for strings in `apps/web/src/locale/zh-TW.json`. Mobile follows the device language.
- Files listed in `scripts/i18n/displayFiles.json` build display copy in helpers (provider status summaries, banner titles, update notices). There, returned values, variable initializers, array elements and `detail`/`message`/`reason`/`body`/`text` properties are translated too. Add a file there when its helper text stays English.
- The Scratch project's title is server data (`No project`); web and mobile relabel it through `createLocalizedEnvironmentSnapshotAtom` in client-runtime. Known server provider status and provider update messages (for example `Checking OMP CLI availability...`, `Update command exited with code 1.`) are matched by `packages/client-runtime/src/providerStatusMessages.ts`; web and mobile display them through their own `locale/serverMessages.ts`; other server-generated text stays English.
- Inline JSX children become one message (`Delete {name} from {project}?`), so translations can reorder values or drop English plural suffixes.
- `scripts/i18n/untranslated.json` keeps names and identifiers English, and keeps English at positions where code compares the literal (for example the `New thread` draft title, which the server checks). Context-record fields that reach agents (`rangeLabel`, `sectionTitle`, `terminalLabel`) are never translated.
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

## Local Mac deployment (2026-10-09)

- Owner instruction: do not publish a GitHub release; replace the existing Mac installation and push source to this fork.
- Installed `0.0.45-nightly.20261009.1791520340` at `/Applications/T3 Code (Nightly).app`, retaining the existing bundle path.
- Installed binary was built from `72bc87b1b972d8b8748c2d2a2210c9773a77800f` and signed with the owner's existing Apple Development certificate; complete bundle verification passed after installation.
- Old app and existing local profiles are preserved in a private local backup outside the repository. No existing user profile was overwritten or manually migrated. Local user paths are not part of this public documentation.
- Source and `patches.md` are pushed to `jason5545/t3code`, branch `main`. Private profile backups are kept outside the repository; DMG/ZIP and local logs remain ignored and are not pushed.
- No release or release tag is created for this deployment.
