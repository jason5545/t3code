import type { ExtensionCallRequest, ExtensionCallResult } from "@t3tools/contracts";
import type { ExtensionContribution } from "@t3tools/shared/extensions";
import { BUILT_IN_EXTENSIONS } from "@t3tools/shared/builtInExtensions";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ExtensionStore from "./ExtensionStore.ts";
import { serverExtensions } from "./index.ts";
import type {
  BuiltInExtensionCall,
  ExtensionCallServices,
  ServerExtensionPoints,
} from "./points.ts";

/**
 * Fork patch 30: runs a method of an extension's server part for its web part. Built-in
 * methods come from the `extensionCalls` point and run with the server's services; an
 * installed one is read from its `server.mjs` on every call, so a reinstall applies at once.
 */
const CALL_TIMEOUT = Duration.seconds(30);
const MAX_RESULT_BYTES = 1024 * 1024;
const BUILT_IN_IDS = new Set(BUILT_IN_EXTENSIONS.map(({ id }) => id));

class ExtensionCallFailed extends Schema.TaggedError<ExtensionCallFailed>()("ExtensionCallFailed", {
  reason: Schema.String,
}) {}
const isCallFailed = Schema.is(ExtensionCallFailed);
const failed = (error: unknown) =>
  new ExtensionCallFailed({
    reason: error instanceof Error && error.message !== "" ? error.message : String(error),
  });

export type PreparedCall =
  | { readonly _tag: "Refused"; readonly error: string }
  | {
      readonly _tag: "Ready";
      readonly readOnly: boolean;
      readonly run: Effect.Effect<ExtensionCallResult>;
    };

interface InstalledCall {
  readonly readOnly: boolean;
  readonly call: (input: unknown, context: { readonly signal: AbortSignal }) => unknown;
}

const refused = (error: string): PreparedCall => ({ _tag: "Refused", error });

/** `calls` of a server part's default export: a function, or `{ readOnly, call }`. */
const readInstalledCalls = (exports: unknown): ReadonlyMap<string, InstalledCall> => {
  const calls =
    typeof exports === "object" && exports !== null && "calls" in exports ? exports.calls : null;
  if (typeof calls !== "object" || calls === null) return new Map();
  return new Map(
    Object.entries(calls).flatMap(([method, value]): Array<[string, InstalledCall]> => {
      // Called with its object as `this`, as `calls.ping(input)` would be.
      if (typeof value === "function") {
        return [
          [method, { readOnly: false, call: (...args) => Reflect.apply(value, calls, args) }],
        ];
      }
      if (typeof value === "object" && value !== null && "call" in value) {
        const call = value.call;
        const readOnly = "readOnly" in value && value.readOnly === true;
        if (typeof call === "function") {
          return [[method, { readOnly, call: (...args) => Reflect.apply(call, value, args) }]];
        }
      }
      return [];
    }),
  );
};

const toJson = (label: string, value: unknown): ExtensionCallResult => {
  let text: string | undefined;
  try {
    text = JSON.stringify(value === undefined ? null : value);
  } catch {
    return { ok: false, error: `${label} returned something that is not JSON.` };
  }
  if (text === undefined) text = "null";
  if (
    text.length > MAX_RESULT_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_RESULT_BYTES
  ) {
    return { ok: false, error: `${label} returned more than 1 MiB.` };
  }
  return { ok: true, value: JSON.parse(text) };
};

const failureText = (label: string, cause: Cause.Cause<ExtensionCallFailed>) => {
  const error = Cause.squash(cause);
  return `${label} failed: ${isCallFailed(error) ? error.reason : failed(error).reason}`;
};

const execute = (label: string, handler: Effect.Effect<unknown, ExtensionCallFailed>) =>
  handler.pipe(
    Effect.timeoutOrElse({
      duration: CALL_TIMEOUT,
      orElse: () => Effect.fail(new ExtensionCallFailed({ reason: "no answer within 30 seconds" })),
    }),
    Effect.exit,
    Effect.map((exit): ExtensionCallResult =>
      Exit.isSuccess(exit)
        ? toJson(label, exit.value)
        : { ok: false, error: failureText(label, exit.cause) },
    ),
    Effect.withSpan("ExtensionCalls.execute", { attributes: { "extension.call": label } }),
  );

export class ExtensionCalls extends Context.Service<
  ExtensionCalls,
  {
    /** Finds the method; the caller checks the scope `readOnly` asks for, then runs it. */
    readonly prepare: (request: ExtensionCallRequest) => Effect.Effect<PreparedCall>;
  }
>()("t3/extensions/ExtensionCalls") {}

const make = Effect.fn("ExtensionCalls.make")(function* (
  builtIns: ReadonlyArray<ExtensionContribution<ServerExtensionPoints["extensionCalls"]>>,
) {
  const store = yield* Effect.serviceOption(ExtensionStore.ExtensionStore);
  const services = yield* Effect.context<ExtensionCallServices>();
  const tables = new Map<string, ReadonlyMap<string, BuiltInExtensionCall>>();
  for (const { id, contribution } of builtIns) {
    tables.set(id, new Map([...(tables.get(id) ?? []), ...Object.entries(contribution)]));
  }

  const prepareBuiltIn = (request: ExtensionCallRequest, label: string): PreparedCall => {
    if (Option.isSome(store) && !store.value.isEnabled(request.id)) {
      return refused(`"${request.id}" is turned off.`);
    }
    const handler = tables.get(request.id)?.get(request.method);
    if (handler === undefined) return refused(`"${request.id}" has no method "${request.method}".`);
    return {
      _tag: "Ready",
      readOnly: handler.readOnly === true,
      run: execute(
        label,
        // @effect-diagnostics-next-line anyUnknownInErrorContext:off - a built-in may fail with anything; it becomes ExtensionCallFailed here
        Effect.suspend(() => handler.call(request.input)).pipe(
          Effect.mapError(failed),
          Effect.provideContext(services),
        ),
      ),
    };
  };

  const prepare = Effect.fn("ExtensionCalls.prepare")(function* (request: ExtensionCallRequest) {
    const label = `${request.id}.${request.method}`;
    if (BUILT_IN_IDS.has(request.id)) return prepareBuiltIn(request, label);
    if (Option.isNone(store)) return refused("This server does not manage extensions.");
    return yield* store.value.serverModule(request.id).pipe(
      Effect.map((module): PreparedCall => {
        const installed = readInstalledCalls(module.exports).get(request.method);
        if (installed === undefined) {
          return refused(`"${request.id}" has no method "${request.method}".`);
        }
        return {
          _tag: "Ready",
          readOnly: installed.readOnly,
          run: execute(
            label,
            Effect.tryPromise({
              try: (signal) => Promise.resolve(installed.call(request.input, { signal })),
              catch: failed,
            }),
          ),
        };
      }),
      Effect.catchTags({ ExtensionError: (error) => Effect.succeed(refused(error.detail)) }),
    );
  });

  return ExtensionCalls.of({ prepare });
});

/** For tests: built-in methods from a list instead of the manifest. */
export const layerWith = (
  builtIns: ReadonlyArray<ExtensionContribution<ServerExtensionPoints["extensionCalls"]>>,
) => Layer.effect(ExtensionCalls, make(builtIns));

export const layer = Layer.effect(
  ExtensionCalls,
  Effect.suspend(() => make(serverExtensions.list("extensionCalls"))),
);
