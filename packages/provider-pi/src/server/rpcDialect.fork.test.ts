import { describe, expect, it } from "vite-plus/test";

import { buildPiRpcLaunch } from "./mcpInjection.ts";
import { makePiRpcDialect } from "./rpcDialect.ts";

describe("Pi RPC dialect (fork)", () => {
  // OMP 18.20.0 exits 2 on --offline; its later --offline restricts auxiliary
  // providers instead of skipping Pi's startup catalog/OAuth refresh.
  it("drops the short-lived --offline for OMP and keeps it for Pi", () => {
    const { args } = buildPiRpcLaunch({
      launchArgs: [],
      environment: {},
      mcpSession: undefined,
      extensionPath: undefined,
      ephemeral: true,
      shortLived: true,
    });
    expect(makePiRpcDialect("pi").launchArgs(args)).toContain("--offline");
    expect(makePiRpcDialect("/opt/homebrew/bin/omp").launchArgs(args)).toEqual([
      "--mode",
      "rpc-ui",
      "--no-session",
    ]);
  });
});
