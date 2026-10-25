import {
  CommandId,
  GuestShareId,
  type OrchestrationV2AppThread,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { decideGuestShareCommand } from "./GuestShareDecider.ts";

const open = (thread: Partial<OrchestrationV2AppThread>) =>
  decideGuestShareCommand({
    thread: {
      archivedAt: null,
      guestShare: null,
      ...thread,
    } as unknown as OrchestrationV2AppThread,
    command: {
      type: "thread.guest-share.open",
      commandId: CommandId.make("open-guest-share"),
      threadId: ThreadId.make("thread:guest"),
      shareId: GuestShareId.make("share"),
      host: "env.t3.test",
      expiresAt: "2026-10-26T00:00:00.000Z",
    },
    now: DateTime.makeUnsafe("2026-10-25T00:00:00.000Z"),
  });

describe("guest shares on ephemeral threads", () => {
  it("refuses to open one, since guest commands skip the ephemeral dispatch wrapper", () => {
    expect(Result.isFailure(open({ ephemeral: true }))).toBe(true);
    expect(Result.isSuccess(open({}))).toBe(true);
  });
});
