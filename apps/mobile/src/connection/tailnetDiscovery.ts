import { TailnetDiscovery } from "@t3tools/client-runtime/connection";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { Atom } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { AppState } from "react-native";

import { connectionAtomRuntime } from "./runtime";

/**
 * Fork patch 7: T3 Code servers that connected environments see on their
 * tailnet, asked in the background while the app is in the foreground (see
 * `watchTailnetDiscovery` for the schedule). Kept alive so the answer and the
 * backoff survive screens that stop reading it.
 */
const foreground = Stream.callback<boolean>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      Queue.offerUnsafe(queue, AppState.currentState === "active");
      return AppState.addEventListener("change", (state) => {
        Queue.offerUnsafe(queue, state === "active");
      });
    }),
    (subscription) => Effect.sync(() => subscription.remove()),
  ),
);

export const tailnetDiscoveryAtom = connectionAtomRuntime
  .atom(TailnetDiscovery.watchTailnetDiscovery(foreground))
  .pipe(Atom.keepAlive, Atom.withLabel("mobile:connection:tailnet-discovery"));
