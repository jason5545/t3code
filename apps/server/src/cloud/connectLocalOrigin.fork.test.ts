import { describe, expect, it } from "@effect/vitest";
import * as NetAddress from "effect/net/NetAddress";

import { connectLocalOrigin } from "./connectLocalOrigin.ts";
import { isAllowedEndpointOrigin, parseManagedEndpointLocalOrigin } from "./linkChecks.ts";

const originFor = (ip: string) =>
  connectLocalOrigin(NetAddress.inetAddressFromIpStringUnsafe(ip, 3773));

describe("T3 Connect local origin (fork patch 32)", () => {
  it("passes the link checks for a server bound to a tailnet address", () => {
    const origin = originFor("100.95.60.35");
    expect(origin).toBe("http://127.0.0.1:3773");
    const parsed = parseManagedEndpointLocalOrigin(origin);
    expect(
      isAllowedEndpointOrigin({ origin: parsed.origin, requestUrl: `${origin}/api/cloud/link` }),
    ).toBe(true);
  });

  it("keeps a loopback bind address and maps wildcards to 127.0.0.1", () => {
    expect(originFor("127.0.0.2")).toBe("http://127.0.0.2:3773");
    expect(originFor("::1")).toBe("http://[::1]:3773");
    expect(originFor("0.0.0.0")).toBe("http://127.0.0.1:3773");
    expect(originFor("::")).toBe("http://127.0.0.1:3773");
  });
});
