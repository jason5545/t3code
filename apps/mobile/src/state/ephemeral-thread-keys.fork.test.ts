import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxStorage } from "./thread-outbox-storage";

const environmentId = EnvironmentId.make("environment-1");

const message = (threadId: string, ephemeralCreation = false): QueuedThreadMessage => ({
  environmentId,
  threadId: ThreadId.make(threadId),
  messageId: MessageId.make(`message-${threadId}`),
  commandId: CommandId.make(`command-${threadId}`),
  text: "text",
  attachments: [],
  createdAt: "2026-10-25T00:00:00.000Z",
  ...(ephemeralCreation
    ? {
        creation: {
          projectId: ProjectId.make("scratch"),
          workspaceMode: "local" as const,
          branch: null,
          worktreePath: null,
          ephemeral: true,
        },
      }
    : {}),
});

async function freshModule() {
  vi.resetModules();
  const keys = await import("./ephemeral-thread-keys");
  const { appAtomRegistry } = await import("./atom-registry");
  return { ...keys, appAtomRegistry };
}

describe("ephemeral thread keys (fork patch 11)", () => {
  it("writes ordinary queued messages and skips ephemeral ones", async () => {
    const { trackEphemeralThreadKeys, withoutEphemeralWrites } = await freshModule();
    const written: Array<string> = [];
    const storage: ThreadOutboxStorage = {
      load: async () => ({ messages: [], errors: [] }),
      write: async (queued) => {
        written.push(queued.threadId);
      },
      remove: async () => {},
    };
    trackEphemeralThreadKeys(new Set([`${environmentId}:thread-ephemeral`]));
    const outbox = withoutEphemeralWrites(storage);

    await outbox.write(message("thread-ordinary"));
    await outbox.write(message("thread-ephemeral"));
    await outbox.write(message("thread-new", true));

    expect(written).toEqual(["thread-ordinary"]);
  });

  it("remembers a purged ephemeral thread as ended, and only that one", async () => {
    const { trackEphemeralThreadKeys, endedEphemeralThreadKeysAtom, appAtomRegistry } =
      await freshModule();
    const purged = `${environmentId}:thread-purged`;
    const open = `${environmentId}:thread-open`;

    trackEphemeralThreadKeys(new Set([purged, open]));
    trackEphemeralThreadKeys(new Set([open]));

    expect([...appAtomRegistry.get(endedEphemeralThreadKeysAtom)]).toEqual([purged]);
  });
});
