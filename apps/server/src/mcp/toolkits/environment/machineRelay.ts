import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient, type HttpClientResponse } from "effect/http";

import * as TailscalePairing from "../../../auth/TailscalePairing.ts";
import * as ServerConfig from "../../../config.ts";

/**
 * Fork patch 22: forwards one T3 tool call to another of the owner's machines, which lets
 * this machine in by its tailnet identity. Online state comes from tailscaled, so a
 * sleeping machine answers at once instead of after a connect timeout.
 */
export const MachineCallParameters = Schema.Struct({
  machine: Schema.String.annotate({
    description: "Name from `t3_environment_read` `tailnet`, such as agent-hub.",
  }),
  tool: Schema.String.annotate({ description: "T3 tool name on that machine." }),
  arguments: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export const MachineCallResult = Schema.Struct({
  machine: Schema.String,
  online: Schema.Boolean,
  /** When an offline machine was last seen. */
  lastSeen: Schema.NullOr(Schema.String),
  /** The tool's structured result, or its text when it has none; absent while offline. */
  result: Schema.optional(Schema.Unknown),
  /** The tool ran and reported a failure. */
  isError: Schema.optional(Schema.Boolean),
});

const INITIALIZE_TIMEOUT = Duration.seconds(10);
const CALL_TIMEOUT = Duration.minutes(2);
const PROTOCOL_VERSION = "2025-06-18";

const JsonRpcResponse = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});
const decodeJsonRpcResponse = Schema.decodeUnknownOption(Schema.fromJsonString(JsonRpcResponse));

const ToolCallResult = Schema.Struct({
  content: Schema.optional(
    Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
  ),
  structuredContent: Schema.optional(Schema.Unknown),
  isError: Schema.optional(Schema.Boolean),
});
const decodeToolCallResult = Schema.decodeUnknownOption(ToolCallResult);
const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const failure = (code: OrchestratorMcpFailure["code"], message: string) =>
  new OrchestratorMcpFailure({ code, message });

/** The response to request `id`, from a JSON body or the `data:` lines of an event stream. */
const jsonRpcResponseOf = (body: string, id: number) => {
  const candidates = body.trimStart().startsWith("{")
    ? [body]
    : body
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim());
  for (const candidate of candidates) {
    const response = decodeJsonRpcResponse(candidate);
    if (Option.isSome(response) && response.value.id === id) return response;
  }
  return Option.none();
};

export class MachineRelay extends Context.Service<
  MachineRelay,
  {
    readonly call: (
      input: typeof MachineCallParameters.Type,
    ) => Effect.Effect<typeof MachineCallResult.Type, OrchestratorMcpFailure>;
  }
>()("t3/mcp/toolkits/environment/machineRelay") {}

const make = Effect.gen(function* () {
  const pairing = yield* TailscalePairing.TailscalePairing;
  const http = yield* HttpClient.HttpClient;

  const call: MachineRelay["Service"]["call"] = Effect.fn("MachineRelay.call")(function* (input) {
    const machines = yield* pairing.ownerMachines();
    if (Option.isNone(machines)) {
      return yield* failure("provider_unavailable", "This machine cannot read tailscaled.");
    }
    const target = machines.value.find(
      (machine) => machine.name.toLowerCase() === input.machine.trim().toLowerCase(),
    );
    if (target === undefined) {
      return yield* failure(
        "invalid_request",
        `No other machine of yours is named ${input.machine}. Known: ${machines.value.map((machine) => machine.name).join(", ") || "none"}. Use this machine's own tools for itself.`,
      );
    }
    if (!target.online) {
      return { machine: target.name, online: false, lastSeen: target.lastSeen };
    }
    if (target.address === null) {
      return yield* failure("provider_unavailable", `${target.name} has no tailnet IPv4.`);
    }
    const url = `http://${target.address}:${ServerConfig.DEFAULT_PORT}/mcp`;
    const unreachable = (cause: unknown) =>
      failure(
        "provider_unavailable",
        `${target.name} is online but its T3 did not answer at ${url}: ${String(cause)}`,
      );

    const post = (body: Readonly<Record<string, unknown>>, sessionId: string | undefined) =>
      http.post(url, {
        headers: {
          accept: "application/json, text/event-stream",
          ...(sessionId === undefined
            ? {}
            : { "mcp-session-id": sessionId, "mcp-protocol-version": PROTOCOL_VERSION }),
        },
        body: HttpBody.text(JSON.stringify({ jsonrpc: "2.0", ...body }), "application/json"),
      });
    const answer = Effect.fn("MachineRelay.answer")(function* (
      response: HttpClientResponse.HttpClientResponse,
      id: number,
    ) {
      if (response.status === 401 || response.status === 403) {
        return yield* failure(
          "capability_denied",
          `${target.name} did not let this machine in. Its T3 needs T3CODE_TAILSCALE_MCP_OWNER_ACCESS.`,
        );
      }
      const body = yield* response.text.pipe(Effect.mapError(unreachable));
      const message = jsonRpcResponseOf(body, id);
      if (Option.isNone(message)) {
        return yield* unreachable(`HTTP ${response.status} without a JSON-RPC answer`);
      }
      if (message.value.error !== undefined) {
        return yield* failure("invalid_request", `${target.name}: ${message.value.error.message}`);
      }
      return message.value.result;
    });

    const initialized = yield* post(
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "t3-machine-call", version: "1" },
        },
      },
      undefined,
    ).pipe(Effect.timeout(INITIALIZE_TIMEOUT), Effect.mapError(unreachable));
    yield* answer(initialized, 1);
    const sessionId = initialized.headers["mcp-session-id"];
    if (sessionId === undefined) return yield* unreachable("no MCP session id");

    const called = Effect.gen(function* () {
      yield* post({ method: "notifications/initialized" }, sessionId).pipe(
        Effect.mapError(unreachable),
      );
      const response = yield* post(
        {
          id: 2,
          method: "tools/call",
          params: { name: input.tool, arguments: input.arguments ?? {} },
        },
        sessionId,
      ).pipe(Effect.timeout(CALL_TIMEOUT), Effect.mapError(unreachable));
      const result = decodeToolCallResult(yield* answer(response, 2));
      if (Option.isNone(result)) return yield* unreachable("a tool result without content");
      const { content, structuredContent, isError } = result.value;
      const text = content?.find((part) => part.type === "text")?.text;
      return {
        machine: target.name,
        online: true,
        lastSeen: null,
        result:
          structuredContent ??
          (text === undefined ? null : Option.getOrElse(decodeJsonText(text), () => text)),
        ...(isError === true && { isError: true }),
      };
    });
    return yield* called.pipe(
      Effect.ensuring(
        http
          .del(url, {
            headers: { "mcp-session-id": sessionId, "mcp-protocol-version": PROTOCOL_VERSION },
          })
          .pipe(Effect.timeout(INITIALIZE_TIMEOUT), Effect.ignore),
      ),
    );
  });

  return MachineRelay.of({ call });
});

export const layer = Layer.effect(MachineRelay, make);
