import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ExtensionHostApi from "./ExtensionHostApi.ts";
import type { ServerExtension } from "./points.ts";

/** `{ threadIds, chars? }` from the web host API; the read API is optional, as everywhere. */
export const latestReplies = Effect.fn("ExtensionHostReads.latestReplies")(function* (
  input: unknown,
) {
  const api = yield* Effect.serviceOption(ExtensionHostApi.ExtensionHostApi);
  if (Option.isNone(api)) {
    return yield* new ExtensionHostApi.ExtensionReadError({
      message: "This server has no read API.",
    });
  }
  const query = typeof input === "object" && input !== null ? input : {};
  return yield* api.value.latestReplies("threadIds" in query ? query.threadIds : undefined, query);
});

/**
 * Fork patch 30, API 4: reads that the web host API needs from every environment, not only the
 * primary one an installed web part's `t3.call` reaches. `t3.threads.readReplies` calls
 * `extension-manager.latestReplies` on each thread's own environment, so a board shows the reports
 * of threads on other machines too. An older server answers that it has no such method.
 */
export const hostReads: ServerExtension = {
  ...builtInExtension("extension-manager"),
  contributes: {
    extensionCalls: [
      {
        latestReplies: {
          readOnly: true,
          call: latestReplies,
        },
      },
    ],
  },
};
