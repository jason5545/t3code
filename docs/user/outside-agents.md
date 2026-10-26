# Outside agents

Agents that T3 Code did not start can work with an environment through its MCP
server. They can read projects and threads, start and message threads, and
check which providers and models are available. This covers Claude Code or
Codex in your own terminal, ChatGPT, and bots that support MCP. Each agent signs
in once, and you choose what it may do.

## Get the MCP URL

In **Settings → Connections**, open a saved environment's menu and choose
**Copy MCP URL**. The URL is the environment's address followed by `/mcp`, for
example:

```text
https://<environment-address>/mcp
```

The copied URL uses the route this device is connected over, so an agent on the
same device can reach it.

- **An agent on your own computers** can use `localhost` on the host, T3
  Connect, or any `https` address, such as
  [Tailscale HTTPS](./remote-access.md#tailscale-https). Signing in sends the
  agent's credentials to the environment, and agents only do that over `https`
  or to `localhost`. A plain-`http` LAN or Tailscale address, like
  `http://100.x.y.z:3773`, lets an agent find the environment but not finish
  signing in.
- **A hosted agent**, such as ChatGPT or a bot running in the cloud, must reach
  the environment from the internet. Use the T3 Connect address. A Tailscale
  address only works from your own tailnet.

## Approve a sign-in

The first time an agent connects, it opens a sign-in page on the environment.
The page names the agent and where its access goes:

- For an agent that signs in through a `localhost` address, the page offers
  **Continue on this computer** after approval. If the agent runs on another
  machine, choose **Copy link** and give the link to the agent there. The link
  works once, within a minute.
- For a hosted agent, approval goes to that service, such as `chatgpt.com`.
  Anyone who runs that service gets the access.

Only approve a sign-in you just started. To approve, enter a pairing code from
**Settings → Connections** or from `t3 auth pairing create` on the host. A
browser already signed in to the environment with permission to manage access
can approve without a code.

Then choose what the agent may do:

- **Read only** is the default. The agent can read projects and threads and see
  the available providers and models. It cannot change anything.
- **Supervised** through **Full access** also let it start, message and stop
  threads in every project. A thread it starts or steers cannot run with more
  permissions than the mode you chose.

## Claude Code

```sh
claude mcp add --transport http t3 https://<environment-address>/mcp
claude mcp login t3
```

`claude mcp login` opens the sign-in page in your browser. On a machine
without a browser, add `--no-browser`, open the printed URL elsewhere, and
paste the final URL back when asked. `claude mcp list` shows `t3` as connected
once you approve.

## Codex

```sh
codex mcp add t3 --url https://<environment-address>/mcp
codex mcp login t3
```

`codex mcp login --no-browser` prints the sign-in URL instead of opening it.
`codex mcp list` shows `t3` with OAuth once you approve.

## ChatGPT

Add the environment as a custom MCP app in ChatGPT's apps settings:

1. Create a new app or plugin with a custom MCP server.
2. Set the server URL to `https://<environment-address>/mcp`, using the T3
   Connect address.
3. Choose **OAuth** for authentication. ChatGPT discovers the rest; you do not
   need a client ID or secret.
4. Create the app, then approve the sign-in page that opens.

## Other agents and bots

Any agent that supports remote MCP servers over HTTP with OAuth can connect. Give
it the MCP URL and choose OAuth, and the agent finds the sign-in settings itself.
Agents without OAuth support cannot connect.

## Bots on tagged tailnet machines

An agent on a tagged machine in your tailnet, such as a bot server, can sign in
without anyone approving it. Start the host with the tags to trust and the most
each may do:

```bash
T3CODE_TAILSCALE_MCP_TAGS="tag:bot=auto-accept-edits" t3 serve --host <tailnet-ip>
```

The agent still signs in over an `https` address, such as
[Tailscale HTTPS](./remote-access.md#tailscale-https), as above.

List several as `tag:a=read-only,tag:b=full-access`. The levels are
`read-only`, `approval-required`, `auto-accept-edits`, `auto` and `full-access`;
a machine with several listed tags gets the lowest. Only a sign-in that returns
to a `localhost` address is approved this way, so the agent can start it with
`curl` or its own browser and nothing leaves that machine. Sign-ins that return
to an https address, and machines with other tags, still use the approval page.

Revoking such an agent sends its machine's next sign-in to the approval page
until you run `t3 auth tailscale unblock` on the host.

## Agents on your own machines

When you run T3 Code on several of your own computers in one tailnet, the
agents on each can use the others' tools with no sign-in at all. Start each host
with the most another of your machines may do:

```bash
T3CODE_TAILSCALE_MCP_OWNER_ACCESS=full-access t3 serve --host <tailnet-ip>
```

Then give the agents the plain tailnet address, `http://<tailnet-ip>:3773/mcp`,
with no authentication. Only untagged machines you own are let in this way. Each
shows up in Settings → Connections as `<machine> (Tailscale)`; revoking it blocks
that machine until you run `t3 auth tailscale unblock` on the host.

`t3_environment_read` lists your other computers and whether each is online, so
an agent can skip one that is asleep instead of waiting on it, and shows the
threads running on its own host and the pull requests they watch.

## Scripts on the host

On the machine that runs the environment, `t3 thread` uses the same tools
without a sign-in:

```sh
id=$(t3 thread start . "Find why the tests are slow")
t3 thread send "$id" "Now fix it" --wait
t3 thread show "$id"
t3 thread list
```

`.` means the project that contains the current folder; a project id also
works. A new thread uses the project's default model and permission mode, and
runs in the project folder unless you pass `--worktree <base-branch>`. `send`
never interrupts: a busy thread gets the message as its next turn. Pass `-` as
the message to read it from stdin.

`--wait` prints the agent's reply. It exits 1 when the run fails or stops, and
2 when the agent waits for an answer you give in the app. Add `--json` for a
result that always includes the thread id.

## Remove an agent

Approved agents appear under **Settings → Connections** like other clients.
Revoke one there to cut off its access immediately. A sign-in lasts 30 days;
after that the agent asks you to approve it again.

To make sign-ins last longer, or to approve several with one code, create the
code on the host with `t3 auth pairing create --session-ttl 180d`, add
`--reusable`, or both. A reusable code approves sign-ins until its own `--ttl`
runs out, so give it one, such as `--ttl 7d`. Either option makes a code that
only approves agent sign-ins and cannot pair a device. `t3 auth pairing revoke`
cancels it early.
