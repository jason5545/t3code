# Outside agents

Connect external agents (Claude Code or Codex in your terminal, ChatGPT, or any OAuth-capable MCP client) to your T3 Code environment over MCP to read projects/threads, launch and message threads, and monitor events.

## Quick setup

Open the command palette (`Cmd/Ctrl+K`) and run **Use T3 Code in another app (MCP)** (or open **Settings → Sharing & access**), pick your app, and follow the prompts.

- Cloud assistants (like ChatGPT or Claude) require **T3 Connect** enabled on the environment.
- To also reach other machines through the same connection, enable **Settings → Labs → Linked environments** and [link them](./remote-access.md#link-another-environment).
- To copy the raw MCP endpoint (`https://<environment-address>/mcp`), open an environment's menu in **Settings → Environments → Copy MCP URL**. OAuth requires `https://` or `localhost` (plain `http://` LAN/Tailscale addresses cannot complete OAuth).

### CLI clients and ChatGPT

- **Claude Code**:
  ```sh
  claude mcp add --transport http t3 https://<environment-address>/mcp
  claude mcp login t3   # add --no-browser on headless hosts
  ```
- **Codex**:
  ```sh
  codex mcp add t3 --url https://<environment-address>/mcp
  codex mcp login t3    # add --no-browser on headless hosts
  ```
- **ChatGPT / other OAuth MCP clients**: Add a custom remote MCP server pointing to `https://<environment-address>/mcp` with **OAuth** authentication (no client ID or secret needed).

## Approve access and permissions

The first time an outside agent connects, approve its sign-in page (via your T3 Connect account, an already-authorized browser, or a one-time pairing code from **Settings → Sharing & access** / `t3 auth pairing create`).

- **Read only**: Inspect projects, threads, providers, and models.
- **Supervised → Full access**: Also launch, message, and stop threads up to the granted permission mode. Managing [workflow runs](./workflows.md) or using approval-skipping agent modes requires **Full access** (or your policy's maximum mode).
- Sign-ins last **30 days**; revoke anytime in **Settings → Sharing & access**.
- For an agent that signs in through a `localhost` address, the page offers **Continue on this computer** after approval. If the agent runs on another machine, choose **Copy link** and give the link to the agent there; the link works once, within a minute.
- For longer sign-ins, or several with one code, create the code with `t3 auth pairing create --session-ttl 180d`, `--reusable`, or both. Give a reusable code its own `--ttl` (such as `--ttl 7d`). Either option makes a code that only approves agent sign-ins and cannot pair a device; `t3 auth pairing revoke` cancels it early.

## Agents on your tailnet

- **Bots on tagged machines** can sign in without anyone approving them. Start the host with the tags to trust and the most each may do, for example `T3CODE_TAILSCALE_MCP_TAGS="tag:bot=auto-accept-edits" t3 serve --host <tailnet-ip>`. List several as `tag:a=read-only,tag:b=full-access`; the levels are `read-only`, `approval-required`, `auto-accept-edits`, `auto` and `full-access`, and a machine with several listed tags gets the lowest. The agent still signs in over an `https` address such as [Tailscale HTTPS](./remote-access.md#tailscale-https), and only a sign-in that returns to `localhost` is approved this way; other sign-ins and other tags use the approval page. Revoking such an agent sends its machine's next sign-in to the approval page until you run `t3 auth tailscale unblock` on the host.
- **Your own machines** can use each other's tools with no sign-in. Start each host with `T3CODE_TAILSCALE_MCP_OWNER_ACCESS=full-access t3 serve --host <tailnet-ip>` (or a lower level), then give agents the plain address `http://<tailnet-ip>:3773/mcp` with no authentication. Only untagged machines you own get in. Each shows up in **Settings → Sharing & access** as `<machine> (Tailscale)`; revoking it blocks that machine until `t3 auth tailscale unblock`.
- Agents inside T3 Code need no setup: `t3_machine_call` runs any T3 tool on another of your computers through its own host, with every provider, and answers at once with when a sleeping computer was last seen. Only full-access threads and clients can use it. `t3_environment_read` lists your other computers, whether each is online, and the threads and watched pull requests on its own host.

## Available tools and limits

Tools that act as a running T3 thread (`delegate_task`, `create_threads`, `request_secret`, `html_render`, `preview_*`, `device_*`, `t3_worktree_handoff`) only work for agents running **inside** T3 Code.

- Use `t3_thread_launch` + `t3_thread_wait` / `t3_thread_read` to run and follow work.
- Pass `projectId` or `threadId` explicitly (or `allProjects: true` on `t3_thread_list`).
- **MCP Events (`io.modelcontextprotocol/events`)**: Bots can poll, stream, or subscribe via HTTPS webhooks (up to 1-hour leases; latest 1,000 milestones buffered in memory) for turn, approval, guest, PR watch, and workflow events. For local webhook testing, set `T3CODE_MCP_WEBHOOK_ALLOWED_HOSTS=localhost,127.0.0.1` on the server.

## Host scripts (`t3 thread`)

On the server machine itself, drive threads directly without OAuth:

```sh
id=$(t3 thread start . "Find why the tests are slow")
t3 thread send "$id" "Now fix it" --wait
t3 thread show "$id"
t3 thread list
```

- Pass `--worktree <base-branch>`, `--title` / `--generate-title`, `--provider <id> --model <slug>`, `--option id=value` (e.g. `reasoningEffort=high` for Codex, `effort=high` for Claude), or `-` to read the prompt from stdin.
- `--wait` prints the reply and exits `1` on failure/stop or `2` when waiting for user input. Add `--json` for structured output including the thread ID.
