import { describe, expect, it } from "vite-plus/test";

import { buildPairingUrl } from "./pairing";

describe("buildPairingUrl (fork)", () => {
  it("builds a bare backend URL when the code is empty", () => {
    expect(buildPairingUrl("100.95.60.35:3773", "")).toBe("http://100.95.60.35:3773/");
    expect(buildPairingUrl("agent-hub.example.ts.net", " ")).toBe(
      "https://agent-hub.example.ts.net/",
    );
  });

  it("reaches a tailnet machine name on the default port over HTTP", () => {
    expect(buildPairingUrl("agent-hub", "")).toBe("http://agent-hub:3773/");
    expect(buildPairingUrl(" agent-hub ", "pairing-token")).toBe(
      "http://agent-hub:3773/#token=pairing-token",
    );
    expect(buildPairingUrl("agent-hub:4000", "")).toBe("http://agent-hub:4000/");
    expect(buildPairingUrl("https://agent-hub", "")).toBe("https://agent-hub/");
    expect(buildPairingUrl("agent-hub.example.ts.net", "")).toBe(
      "https://agent-hub.example.ts.net/",
    );
  });
});
