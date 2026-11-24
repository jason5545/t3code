# T3 Code

T3 Code is a minimal GUI for coding agents. A Node WebSocket server wraps provider CLIs and agents (Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Kiro, Pi, Muse Code, fx) and serves web, desktop, and mobile clients.

You can think of T3 Code as an open source "bring-your-own-subscription" alternative to apps like Claude Desktop, Codex App, Cursor Glass and Conductor.

## What makes T3 Code special?

We have over 500,000 users who love T3 Code. It's important we maintain the things they love as we continue to iterate on the product. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

T3 Code is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. A large number of our users run forks (our MIT license covers source code only, not T3 Code's trademarks or branding; see [TRADEMARK.md](TRADEMARK.md)). We work in the open, and should strive to stay that way.

### 2. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance of T3 Code. We regularly audit for performance regressions, often caused by sending too much data over websockets, css animations causing gpu spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 3. Remote ready

The architecture of T3 Code's websocket layer (`t3`) enables a lot of awesome remote features. These have become core to the product. Whether users are connecting directly over their local network, using Tailscale, or leaning in fully with T3 Connect (our tunnel solution, also in this repo), we need to make sure new features are properly supported.

### 4. Multi-surface

T3 Code has 3 key app surfaces: **web**, **desktop**, and **mobile**.

**Web** is kind of two surfaces, as we have the public facing "app.t3.codes" as well as locally hosting the web app through the `t3` command. Both need to be supported by all new features where reasonable.

**Desktop** is the main surface most users install first. It's a full Electron app that bundles the server runner as well. The desktop app can also be used as the host server, allowing remote connections from app.t3.codes or the mobile app.

**Mobile** is a React Native app for both iOS and Android, available on the App Store and Google Play. The mobile app allows for connecting to any T3 Code server to control work remotely.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most T3 Code contributions will come from T3 Code itself, often controlled remotely. This means you should be careful about accessing data, killing dev servers, and other things that may damage the T3 Code instance that the contributor is using.

## Terminology

- **you** = the agent reading this file. **we / us / maintainers** = Theo, Julius, and the people building T3 Code. **user** = person driving coding agents in T3 Code. **agent** = coding agent running inside T3 Code.
- Domain terms (environment, project, thread, turn, provider, checkpoint, etc.): [00_glossary.md](docs/internals/00_glossary.md).

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port from `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is your worktree.
2. **Writing to the live install.** `~/.t3/userdata` is the developer's real T3 Code database, in use while you work. Reading or copying from it is fine. Never start a server against it, never open it read-write, never clean it up.
3. **Baking in origins.** Never set `VITE_HTTP_URL` or `VITE_WS_URL` for dev. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`. Setting them bakes localhost into the bundle and silently breaks every remote browser.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** Chat view, Settings, command palette, and keybindings. Fixing one is not fixing the feature.
- **Clients.** Web, desktop (Electron shell/IPC), and mobile (React Native). Shared logic lives in `packages/client-runtime`.
- **Providers.** Every provider adapter needs a decision, even if the decision is "not supported here".
- **Agents.** Capabilities a user triggers should be service methods reachable by MCP tools and scheduled tasks, not inline handler code.
- **Contracts.** Wire changes go in `packages/contracts` so server, web, mobile, and desktop follow.
- **Reverse states.** Every way in needs a way out and a way to see it (snooze/unsnooze, close/reopen). A one-way door is a bug.
- **Connection modes.** Local, remote/relay, and tunnel; multi-device and multi-environment.
- **Languages.** Translate user-facing copy in `apps/{web,mobile}/src/i18n/translations` (`vp run i18n:generate` / `vp run i18n:check`) and `apps/marketing/src/i18n`. See [14_i18n.md](docs/internals/14_i18n.md).
- **Docs.** Check whether the change makes existing guidance inaccurate. Follow [Documentation](#documentation).

## Dev servers and test data

See [00_development.md](docs/operations/00_development.md) for setup, ports, seeding (`vp run migrate-dev-db`), and [reusable dev auth](docs/operations/00_development.md#reusable-dev-credential). Agent-specific rules:

- **Worktree setup:** Wait while `.t3/setup-running` names a live PID; do not run `vp i` concurrently. If no `.t3/setup-*` marker exists, run `vp i` yourself.
- **Process lifecycle:** Start dev servers, Metro, and builds from your own shell so they exit with your session—never detach with `systemd-run`, `nohup`, `setsid`, or `tmux` unless asked. Stop background tasks with your harness's own stop (`vp` does not forward SIGTERM to child Vite/server processes).
- **Sharing (`vp run dev --share`):** Wait for `pairingUrl:` and hand the full URL to the user. Never wire `tailscale serve` by hand, open the URL yourself, or consume the user's one-time pairing link. Mint another with `node apps/server/src/bin.ts pair` if needed.
- **Test data:** Always copy in (never symlink) and refresh `statev2.sqlite`, not `state.sqlite`. Bring `secrets` / `settings.json` only if the flow under test needs them.
- **Extra checkouts:** Put `git worktree add` next to this worktree, not in `/tmp`, and remove it when done.

## Verifying

- Before you push, run `vp run check:changed`. **Do not run repo-wide checks** (`vp check`, `vp run -r test`, `vp run -r typecheck`) unless asked—CI owns the full suite.
- Iterate with `vp test run <files>` (add `-t "<name>"` for large files) and `vp run typecheck` (`effect-tsgo tsrs --noEmit`). Run `node -e` snippets from the owning package (`effect` does not resolve from repo root).
- Follow [15_testing.md](docs/internals/15_testing.md) for what to test, bug-fix proof, draining async work (no sleeps/polling), web browser tests (`await using screen = await render(...)`), and real-app [Scenarios](docs/internals/15_testing.md#scenarios) (`vp run scenarios:prove`).
- Give user-visible frontend changes one integrated pass in a real client: `test-t3-app` for web, `test-t3-mobile` for mobile (primary agent only; subagents do not launch dev servers). Inspect the rendered result and walk the flow as a user using the feature—checking layout, visual hierarchy, and ergonomics—and fix anything rough until you are satisfied before handing back. Use the free `Replay (dev)` provider unless the change depends on a real provider (then pick its cheapest model, e.g. Haiku or Luna). On mobile, run `vp run mobile:install <ios|android> [device-id]` before Metro rather than rebuilding from scratch.

## Evals

`evals/` checks how real models behave with T3 Code's model-facing text: agent instructions, MCP tool descriptions and schemas, and generated titles. Before changing that text, read [evals/README.md](evals/README.md) and run the evals it names. When fixing a model behavior bug, add a case that fails before the fix.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- `origin` is not always GitHub. Check `git remote get-url origin` before your first forge command and use that forge's CLI and skill. See [Forge mirror](docs/operations/00_development.md#forge-mirror-optional).
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images; motion or timing needs a short video. Upload PR evidence to GitHub—never commit PR-only screenshots or assets.
- One request is one PR. Split only when asked. Outside contributions follow [CONTRIBUTING.md](CONTRIBUTING.md#one-problem).
- When babysitting: call `watch_pull_request` and end your turn. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new; stop when bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields, methods, constants, timeouts, or migration numbers, narrate control flow, maintain file catalogs, or append PR summaries. Anything that can drift will drift; types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks in the shipped product's voice, without implementation details or contributor tooling. Focus on what a feature does, how to start, and anything unintuitive—not descriptions of buttons, layouts, or UI tweaks.
- `docs/operations/` holds maintainer setup, release, and debugging runbooks. Keep end-user server instructions in `docs/user/`.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files (keep temporary material outside the worktree).
- Track active maintainer work in its GitHub issue or project item; external proposals belong in Ideas discussions. A merged PR is the implementation record.

## Where code lives

- `apps/server` - WebSocket, event-sourced orchestration (`Orchestrator` → `EventSink` → `EffectWorker`), providers, checkpointing. Read [02_effect-services.md](docs/internals/02_effect-services.md) and `.repos/effect/LLMS.md`.
- `apps/web` - React/Vite UI. `apps/desktop` wraps it; `apps/mobile` is React Native; `apps/marketing` is the site.
- `packages/contracts` - Effect/Schema wire contracts plus small derived helpers. No heavy runtime logic.
- `packages/shared` - shared runtime utils, subpath exports, no barrel.
- `packages/client-runtime` - client connection and domain state shared by web and mobile.
- `.repos/` - vendored read-only references. Never edit or import from them (`vpr sync:repos` updates them; if sparse-checked-out, read via `git show origin/main:.repos/<path>`).

### Internal docs by area

Read the matching doc before changing code in that area; code review enforces them.

| Area                                       | Read first                                                                                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & orchestration               | [00_glossary.md](docs/internals/00_glossary.md), [01_architecture.md](docs/internals/01_architecture.md)                                                                                          |
| Server Effect services & errors            | [02_effect-services.md](docs/internals/02_effect-services.md)                                                                                                                                     |
| Providers & ACP                            | [03_providers.md](docs/internals/03_providers.md)                                                                                                                                                 |
| Auth, MCP, guest links, assets, security   | [04_environment-auth.md](docs/internals/04_environment-auth.md), [SECURITY.md](SECURITY.md)                                                                                                       |
| Remote routes, peer links, previews        | [05_remote.md](docs/internals/05_remote.md)                                                                                                                                                       |
| T3 Connect & relay                         | [06_t3-connect.md](docs/internals/06_t3-connect.md)                                                                                                                                               |
| Server updates & crash recovery            | [07_server-updates.md](docs/internals/07_server-updates.md)                                                                                                                                       |
| Telemetry & analytics                      | [08_product-analytics.md](docs/internals/08_product-analytics.md)                                                                                                                                 |
| Client connection & sync runtime           | [09_connection-runtime.md](docs/internals/09_connection-runtime.md)                                                                                                                               |
| Web UI primitives, styles & React Compiler | [10_web-ui.md](docs/internals/10_web-ui.md)                                                                                                                                                       |
| Mobile layout, navigation & dev lifecycle  | [11_mobile-layout.md](docs/internals/11_mobile-layout.md), [12_mobile-navigation.md](docs/internals/12_mobile-navigation.md), [13_mobile-development.md](docs/internals/13_mobile-development.md) |
| Translations & UI copy                     | [14_i18n.md](docs/internals/14_i18n.md)                                                                                                                                                           |
| Writing & reviewing tests                  | [15_testing.md](docs/internals/15_testing.md)                                                                                                                                                     |
| Wire budgets, server metrics & perf        | [16_performance-regressions.md](docs/internals/16_performance-regressions.md)                                                                                                                     |
| Repo & package scripts                     | [17_scripts.md](docs/internals/17_scripts.md)                                                                                                                                                     |

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Client mutations use `createEnvironmentRpcCommand`, declare protected methods in `CLIENT_GUARDED_RPC_SCOPES`, and gate UI with `permissionAtom` (server stays authoritative). Keep raw RPC clients inside `rpc/`.
- Server features are Effect services using `Effect.fn("Service.operation")` with thin transport handlers; see [02_effect-services.md](docs/internals/02_effect-services.md).
- `apps/web/src/components/ui` exports own their look (`shadcn/no-restyle` enforces this); see [10_web-ui.md](docs/internals/10_web-ui.md).
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, external quirk, or invariant the code can't show (1–4 lines max; `t3code/no-low-value-comments` enforces this).
- React effects are only for synchronizing with external systems. Derive in render and act in handlers; any remaining effect states its reason via `// oxlint-disable-next-line t3code/no-unreasoned-state-sync -- <why>`.
- No continuously repainting animations; they peg the GPU on high-refresh displays.
- Security matters, but do not over-index on dev-mode or maintainer-only features. Read [SECURITY.md](SECURITY.md) before auditing or triaging reports.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## This fork

This checkout is `jason5545/t3code`. Upstream owns everything above; keep fork notes in this last section so upstream merges do not conflict with them. Fork patches, build recipes and the deployment record live in [patches.md](patches.md). Commit and push straight to `origin main`; this fork does not use PRs or feature branches.

### New fork features use extension points

A fork feature that adds something to a surface (an MCP tool, a settings section, a row, a badge, a watcher) goes through an extension point, not a new import in an upstream file. Read "Extension system" in [patches.md](patches.md) first: it lists the points, how to add one, the load-order trap, and what deliberately stays a patch. Fork services stay optional Effect services and never add to an upstream service's requirements.

A different interface (a new layout, a board in place of the sidebar and chat) is not an edit to upstream's components. It is an extension that fills the web `app.interface` point: with the extension off the app is upstream's, and with it on the user switches to it with a button. "Interfaces" under "Extension system" in patches.md has the contract.

### Every change starts with a sync

Any change to the fork, whether a bug fix, a translation or an update, starts by syncing upstream: steps 1 and 2 below, before reading the code you will change (owner decision, 2026-10-31). It is required every time, not only when upstream might already have fixed the problem; the change then lands on the code that will ship. Deploy the sync and the change together, then carry on as usual.

### Syncing upstream

A sync is finished only when the agent-hub server runs the synced commit, the record is pushed and t3.hiroki.im shows the sync:

1. Before merging, look for regressions the merge would bring in: upstream issues opened since the date of patches.md's "Upstream baseline", most commented first (`gh issue list -R pingdotgg/t3code --state open --search "created:>=<date> sort:comments-desc"`). Upstream `main` is nightly quality: the 2026-10-30 sync took in #27443, where a new thread's reply never showed, four hours after it was reported with dozens of confirmations. For an open regression in the commits being merged, carry the maintainers' open fix PR: apply only its source files (its test edits upstream test files), run its test once to see it fail before and pass after, and add a numbered patches.md section to drop when upstream merges it (section 28 is the example). With no fix PR yet, fix it in the fork when the cause is clear and the fix is small (a few lines in one area): failing test first in a `*.fork.test.ts`, then a numbered patches.md section the same way. Then tell the owner whether it can also go upstream as an issue and a PR ("Reporting upstream" below; check CONTRIBUTING.md's eligibility), and open them only on the owner's go-ahead. A fix that is not small goes to the owner before merging.
2. Merge `upstream/main`, resolve conflicts and finish the new translations (patches.md section 2: gt-react's zh-TW catalogs first, then the build-time catalog). Icon, logo and wordmark conflicts keep the fork's dot-matrix T3 (patches.md section 8). Fork test cases go in `*.fork.test.ts` files, not upstream's test files (patches.md "Fork tests"). Commit and push to `origin main`.
   When upstream re-indents code the fork also edits (an `Effect.fn` sweep, a formatter change), merge with `-X ignore-space-change`. It keeps the fork's indentation on lines upstream only re-indented, so afterwards check out upstream's copy of every file that differs from it only in whitespace, and run `vp fmt` on the files that keep fork edits.
3. Rebuild and restart the agent-hub server (`ssh agent-hub`) from that commit with the rebuild command in the header of `/etc/systemd/system/t3code.service`; see "agent-hub headless server" in patches.md. The restart interrupts running turns there, so check for them first. Confirm the server listens only on its tailnet address and the Mac reconnects.
4. Update "Current deployment" in patches.md with the commit each surface runs (Mac nightly, Android APK, agent-hub), then commit and push.
5. Update the public sync notes at https://t3.hiroki.im (owner decision, 2026-11-03). The page is `~/GitHub/hiroki.im/t3/public/index.html` on the Mac, in the private repo `jason5545/hiroki.im`, not this one; a sync finished on another machine hands this step to a Mac thread. The "同步紀錄" section keeps every sync (owner decision, 2026-11-12): add this merge as a new `<details class="sync" id="sync-<upstream hash>" open>` at the top of `<div class="sync-log">`, copying the entry below it, and drop `open` from the entry that was on top. Never rewrite or delete older entries; a correction to an earlier sync goes into that entry only. Write the entry in Traditional Chinese for outside readers: the `<time>` in Taipei time (`datetime="YYYY-MM-DDTHH:MM+08:00"`, shown as `MM/DD HH:MM`, the time the page is updated), the upstream and commit-count tags in the `<summary>` plus a `MERGE NOTE <n>` tag when there are notes, the summary line as `<p class="gist">`, the upstream, commit-count, merge-commit and translated-string pills, and the grouped list of changes (`<h4>` group titles) with a link to each upstream PR. Mark the places where the merge touched fork changes as amber `note` lines (MERGE NOTE). Also update the date in the header's `SYNC` cell and the upstream hash and date under the dot-matrix mark. A sync changes only that content: the page's design (styles, layout, the other sections) carries over from sync to sync, so do not restyle it as part of a sync. When patches.md gains or loses a section the page shows under "fork 多了什麼", change that tile too. Before deploying, check the commit count with `git rev-list --count <previous baseline>..<new baseline>` and every linked PR with `gh api repos/pingdotgg/t3code/pulls/<n>`. The page names no machines, addresses or accounts, and uses no magenta (reserved for LiSA on the owner's sites). Deploy with `npx wrangler deploy` in `~/GitHub/hiroki.im/t3`, confirm the workers.dev address the deploy prints serves the new text, and commit and push the page to `jason5545/hiroki.im`.

### Traditional Chinese translations

The owner is strict about zh-TW, and the fork's translations ship under the owner's name, upstream included (owner decision, 2026-11-24). Machine output is a draft, never a translation: OpenCC `s2twp` converts the script and few words, so 不可用, 當前, 批准, 超時, 憑據, 響應 and the like survive it. `gtCatalog.ts --fill` writes drafts to `scripts/i18n/gtTranslations.pending.json`, which the catalogs never read; read every entry against its English, fix it, then `--accept` moves them into `gtTranslations.json`. `gtCatalog.fork.test.ts` fails on a pending file left behind and on the mainland wording listed in `scripts/i18n/zhTwWording.ts` in any shipped catalog. When a replacement depends on the English (原則 only for policy, 則 only for messages, an email's 地址 stays), decide it per entry. When the owner corrects one word, find every entry with the same problem, not only the one named. Describe where a translation came from as it did: say which entries a person read, which only had their wording replaced after a machine conversion, and which nobody has read; never call machine output "the fork's translation".

On 2026-11-20 `--fill` wrote 5,331 unreviewed `s2twp` entries straight into `gtTranslations.json`, and on 2026-11-23 upstream PR #34720 called them "from the fork"; an outside contributor listed the mainland wording on the PR, in public.

### Installing on the Mac

A thread inside the Mac app installs the build itself; no hand-off to Claude desktop is needed (first done 2026-11-12). Build with `scripts/build-fork-nightly.sh`, then run `scripts/install-fork-nightly.sh release/fork-nightly/<version>` as the turn's last step before checking. It verifies the build and swaps the app from its own session, so quitting T3 cuts the calling turn off; T3's restart continuation resumes that turn, which reads `release/fork-nightly/<version>/install.log`, checks the new server and deletes `<version>/stage`, where the previous bundle is kept. Check for other running threads first, as for agent-hub. Details are under "Local Mac deployment" in [patches.md](patches.md).

### Reporting upstream

A fork fix that also belongs upstream goes there as an issue and a PR under [CONTRIBUTING.md](CONTRIBUTING.md), with the failing-first test upstream already requires.

A large fix (a substantial bug fix in CONTRIBUTING.md's terms) needs a triaged issue first, so offer the owner only the issue; bring up the PR once maintainers have triaged it (owner decision, 2026-10-31). pingdotgg/t3code#27912 was opened beside its untriaged issue #27911 and closed until triage.

Prepare the upstream copy apart from the fork, before asking the owner to open it. Branch from `upstream/main` in a worktree next to this checkout, never from the fork's `main`, and put the fix and its test in upstream's own test file, not a `*.fork.test.ts`. On that branch, record the before and after: the test's failing output on `upstream/main` and its passing output with the fix, and for a UI change before/after screenshots (a short recording for motion or timing), attached to the PR, never committed. The PR body follows CONTRIBUTING.md: one problem, the triaged issue it fixes or why it qualifies as a small fix for an obvious bug, reproduction steps, environment, the checks run and what could not be checked, a conventional title, and the model and harness at the end. Push that branch to the fork under its own name (the no-branch rule covers the fork's own work, not upstream PRs). Show the owner the full issue and PR text, and open them only on the owner's go-ahead. If a release could ship the bug, the issue also names the existing check that should have caught it and why it did not: for #25840, the packaged-server self-check ran only for Windows builds. Fixing that check is a separate problem, so it stays out of the PR, and it gets its own PR only when the owner asks. `release.yml` runs on tags, schedules and dispatch, so an outside PR cannot show a release-job change working, and maintainers closed the #25840 gap within two hours (#25900, #25928).
