# Fork patches

Repository: https://github.com/jason5545/t3code
Upstream baseline: `bfec2387b8102975c84690f99be0f5f834fd0cbe`.

## 1. OMP provider

- OMP is an independent provider instance with display name `OMP` and executable `omp`.
- It shares the Pi driver, without overwriting a user's existing Pi configuration.
- New/legacy settings that omit `providerInstances` receive the OMP default. Explicit instance maps, including an empty map, remain unchanged. Existing users can add OMP in Settings → Providers.
- The creation wizard offers Pi and OMP separately, with independent drafts.
- OMP JSONL dialect adapts command discovery, correlated prompt admission/completion, background settlement, queue state, and before-user branch semantics. Pi remains a passthrough.
- Compatible protocol was inspected from installed OMP `18.7.0`; tests cover these adaptations. No model-generation request was used during verification.

## 2. Taiwan Traditional Chinese interface

- Adds `en` and `zh-TW`, a saved device-local language selection, Traditional Chinese browser defaults, English fallback and reactive document language.
- The General and Appearance settings contain the language selector.
- Translates primary navigation/settings headings, settings search, chat/composer and approval controls, code/message copy controls, empty states and common provider controls.
- User content, code, paths and provider/model labels are not translated.
- Coverage is intentionally partial. Some detailed descriptions, secondary dialogs/errors and the mobile interface remain English.
- Desktop packaging retains both Chromium `zh-TW.pak` (Windows/Linux) and `zh_TW.lproj` (macOS). Electron Builder compares locale basenames literally, so both separator spellings are listed. The initial unpublished build exposed this mismatch; it was corrected before release.

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

Run focused provider/protocol, contract/settings, locale/UI and packaging/signing tests, followed by web/server typechecks. Publish only after artifact signature and bundled fork update feed verification.

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
