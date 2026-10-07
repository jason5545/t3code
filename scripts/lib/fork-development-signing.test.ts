import { describe, expect, it } from "vite-plus/test";
import { resolveDevelopmentSigningConfig } from "./fork-development-signing.ts";

const valid = {
  mode: "development",
  identity: "A".repeat(40),
  repository: "jason5545/t3code",
  platform: "mac",
  version: "0.0.45-nightly.20261007.1",
  signed: true,
};

describe("fork development signing", () => {
  it("does not change standard distribution signing", () => {
    expect(resolveDevelopmentSigningConfig({ ...valid, mode: "distribution" })).toBeUndefined();
  });
  it("requires this fork and a signed macOS nightly with a real identity hash", () => {
    expect(resolveDevelopmentSigningConfig(valid)).toEqual({
      identity: valid.identity,
      appId: "com.jason5545.t3code.nightly",
      productName: "T3 Code Jason (Nightly)",
    });
  });
  it.each([
    { mode: "unknown" },
    { signed: false },
    { platform: "win" },
    { repository: "pingdotgg/t3code" },
    { repository: "" },
    { version: "0.0.45" },
    { version: "0.0.45-preview.1" },
    { identity: "-" },
    { identity: "Apple Development: someone" },
    { identity: "" },
  ])("fails closed for %j", (change) => {
    expect(() => resolveDevelopmentSigningConfig({ ...valid, ...change })).toThrow();
  });
});
