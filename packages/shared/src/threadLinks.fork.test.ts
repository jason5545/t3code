import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { threadLinkRefs } from "./threadLinks.ts";

const ref = (environmentId: string, threadId: string) => ({
  environmentId: EnvironmentId.make(environmentId),
  threadId: ThreadId.make(threadId),
});
const local = EnvironmentId.make("local");

describe("thread links (fork)", () => {
  it("lists a message's thread links on runtimes whose matchAll omits named groups, such as Hermes", () => {
    const matchAll = String.prototype.matchAll;
    using _hermes = vi.spyOn(String.prototype, "matchAll").mockImplementation(function (
      this: string,
      regexp: RegExp,
    ) {
      return matchAll.call(this, regexp).map((match) => {
        delete match.groups;
        return match;
      });
    });
    expect(
      threadLinkRefs("<t3-thread://v2/local/mcp:t1> [a](t3-thread://v2/there/t2)", local),
    ).toEqual([ref("local", "mcp:t1"), ref("there", "t2")]);
  });
});
