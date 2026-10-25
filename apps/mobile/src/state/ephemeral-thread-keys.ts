/**
 * Fork patch 11: ephemeral threads on mobile. Nothing of them reaches the
 * device's storage: their drafts and queued messages stay in memory. Kept
 * apart from `./threads` so the storage modules do not load the shell atoms.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxStorage } from "./thread-outbox-storage";

let knownEphemeralThreadKeys: ReadonlySet<string> = new Set();

/**
 * Ephemeral threads seen this session that have since been purged, so their
 * screens say the conversation ended instead of offering to reconnect. In memory only.
 */
export const endedEphemeralThreadKeysAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
);

export function trackEphemeralThreadKeys(current: ReadonlySet<string>): void {
  const ended = [...knownEphemeralThreadKeys].filter((key) => !current.has(key));
  knownEphemeralThreadKeys = current;
  if (ended.length === 0) return;
  appAtomRegistry.update(
    endedEphemeralThreadKeysAtom,
    (previous) => new Set([...previous, ...ended]),
  );
}

export function isEphemeralThreadKey(key: string): boolean {
  return knownEphemeralThreadKeys.has(key);
}

/** A queued message that starts an ephemeral thread, or is for one. */
export function isEphemeralQueuedMessage(message: QueuedThreadMessage): boolean {
  return (
    message.creation?.ephemeral === true ||
    isEphemeralThreadKey(scopedThreadKey(scopeThreadRef(message.environmentId, message.threadId)))
  );
}

/**
 * The outbox keeps an ephemeral thread's messages in memory until they are sent.
 * Each call reads `storage` afresh, so spies placed on it later still apply.
 */
export function withoutEphemeralWrites(storage: ThreadOutboxStorage): ThreadOutboxStorage {
  return {
    load: () => storage.load(),
    write: (message) =>
      isEphemeralQueuedMessage(message) ? Promise.resolve() : storage.write(message),
    remove: (message) => storage.remove(message),
  };
}
