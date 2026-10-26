import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as TailscalePairing from "../../../auth/TailscalePairing.ts";
import * as MachineRelay from "./machineRelay.ts";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly session: string | undefined;
  readonly rpc: string | undefined;
  readonly arguments?: unknown;
}

// Shaped like the owner's tailnet on 2026-10-27, while the Mac slept.
const MACHINES: ReadonlyArray<TailscalePairing.TailnetMachine> = [
  {
    name: "macbook-pro-810a",
    os: "macOS",
    online: false,
    lastSeen: "2026-10-26T18:13:05Z",
    address: "100.89.162.36",
  },
  { name: "agent-hub", os: "linux", online: true, lastSeen: null, address: "100.95.60.35" },
];

const stream = (message: unknown) => `event: message\ndata: ${JSON.stringify(message)}\n\n`;

const layerTest = (seen: Array<Seen>, options: { readonly status?: number } = {}) =>
  MachineRelay.layer.pipe(
    Layer.provide(
      Layer.mock(TailscalePairing.TailscalePairing)({
        ownerMachines: () => Effect.succeedSome(MACHINES),
      }),
    ),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            const text =
              request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
            const rpc = text === "" ? undefined : JSON.parse(text);
            seen.push({
              method: request.method,
              url: request.url,
              session: request.headers["mcp-session-id"],
              rpc: rpc?.method,
              ...(rpc?.method === "tools/call" && { arguments: rpc.params }),
            });
            const reply =
              options.status !== undefined
                ? new Response("{}", { status: options.status })
                : rpc?.method === "initialize"
                  ? new Response(
                      stream({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
                      {
                        headers: { "content-type": "text/event-stream", "mcp-session-id": "s-1" },
                      },
                    )
                  : rpc?.method === "tools/call"
                    ? new Response(
                        stream({
                          jsonrpc: "2.0",
                          id: 2,
                          result: {
                            content: [{ type: "text", text: '{"label":"agent-hub"}' }],
                            structuredContent: { label: "agent-hub" },
                          },
                        }),
                        { headers: { "content-type": "text/event-stream" } },
                      )
                    : new Response(null, { status: 202 });
            return HttpClientResponse.fromWeb(request, reply);
          }),
        ),
      ),
    ),
  );

const call = (input: typeof MachineRelay.MachineCallParameters.Type) =>
  Effect.flatMap(MachineRelay.MachineRelay, (relay) => relay.call(input));

it.effect("answers for a sleeping machine at once, without connecting to it", () => {
  const seen: Array<Seen> = [];
  return Effect.gen(function* () {
    const result = yield* call({ machine: "macbook-pro-810a", tool: "t3_environment_read" });
    assert.deepStrictEqual(result, {
      machine: "macbook-pro-810a",
      online: false,
      lastSeen: "2026-10-26T18:13:05Z",
    });
    assert.deepStrictEqual(seen, []);
  }).pipe(Effect.provide(layerTest(seen)));
});

it.effect("calls the tool on an online machine and closes the session", () => {
  const seen: Array<Seen> = [];
  return Effect.gen(function* () {
    const result = yield* call({
      machine: "Agent-Hub",
      tool: "t3_thread_list",
      arguments: { projectId: "agent-channel" },
    });
    assert.deepStrictEqual(result, {
      machine: "agent-hub",
      online: true,
      lastSeen: null,
      result: { label: "agent-hub" },
    });
    assert.deepStrictEqual(seen, [
      {
        method: "POST",
        url: "http://100.95.60.35:3773/mcp",
        session: undefined,
        rpc: "initialize",
      },
      {
        method: "POST",
        url: "http://100.95.60.35:3773/mcp",
        session: "s-1",
        rpc: "notifications/initialized",
      },
      {
        method: "POST",
        url: "http://100.95.60.35:3773/mcp",
        session: "s-1",
        rpc: "tools/call",
        arguments: { name: "t3_thread_list", arguments: { projectId: "agent-channel" } },
      },
      {
        method: "DELETE",
        url: "http://100.95.60.35:3773/mcp",
        session: "s-1",
        rpc: undefined,
      },
    ]);
  }).pipe(Effect.provide(layerTest(seen)));
});

it.effect("names the known machines for an unknown one", () =>
  Effect.gen(function* () {
    const unknown = yield* Effect.flip(call({ machine: "agent-fr", tool: "t3_project_list" }));
    assert.equal(unknown.code, "invalid_request");
    assert.include(unknown.message, "macbook-pro-810a, agent-hub");
  }).pipe(Effect.provide(layerTest([]))),
);

it.effect("says what the other machine needs when it refuses this one", () =>
  Effect.gen(function* () {
    const refused = yield* Effect.flip(call({ machine: "agent-hub", tool: "t3_project_list" }));
    assert.equal(refused.code, "capability_denied");
    assert.include(refused.message, "T3CODE_TAILSCALE_MCP_OWNER_ACCESS");
  }).pipe(Effect.provide(layerTest([], { status: 401 }))),
);
