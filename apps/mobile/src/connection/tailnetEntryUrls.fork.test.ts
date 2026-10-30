import { describe, expect, it } from "vite-plus/test";

import { parseTailnetEntryUrls } from "./tailnetEntryUrls";

describe("tailnet entry URLs", () => {
  it("is off when unset and keeps https hosts with an optional port", () => {
    expect(parseTailnetEntryUrls(undefined)).toEqual([]);
    expect(parseTailnetEntryUrls(" ")).toEqual([]);
    expect(
      parseTailnetEntryUrls("https://agent-hub.tailb20be.ts.net/, https://nas.tail.ts.net:8443"),
    ).toEqual(["https://agent-hub.tailb20be.ts.net/", "https://nas.tail.ts.net:8443/"]);
  });

  it.each([
    "http://agent-hub.tailb20be.ts.net/",
    "https://agent-hub.tailb20be.ts.net/t3",
    "https://user:pass@agent-hub.tailb20be.ts.net/",
    "https://agent-hub.tailb20be.ts.net/?pair=1",
    "https://agent-hub.tailb20be.ts.net/?",
    "https://agent-hub.tailb20be.ts.net/#top",
    "agent-hub",
  ])("rejects %s", (entry) => {
    expect(() => parseTailnetEntryUrls(entry)).toThrow(entry);
  });
});
