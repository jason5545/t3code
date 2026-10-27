import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { mergeDiscoveredServers } from "./tailnetDiscovery.ts";

describe("tailnet server discovery", () => {
  it("offers each environment once and leaves out the ones already added", () => {
    const server = (environmentId: string, httpBaseUrl: string) => ({
      environmentId: EnvironmentId.make(environmentId),
      label: environmentId,
      httpBaseUrl,
      nodeName: environmentId,
    });
    expect(
      mergeDiscoveredServers(
        [
          [server("mac", "http://100.89.162.36:3773/"), server("added", "http://100.64.0.2:3773/")],
          [server("mac", "https://mac.tail.ts.net/"), server("nas", "https://nas.tail.ts.net/")],
        ],
        new Set([EnvironmentId.make("added")]),
      ).map((entry) => [entry.environmentId, entry.httpBaseUrl]),
    ).toEqual([
      ["mac", "http://100.89.162.36:3773/"],
      ["nas", "https://nas.tail.ts.net/"],
    ]);
  });
});
