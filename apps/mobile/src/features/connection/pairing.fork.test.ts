import { describe, expect, it } from "vite-plus/test";

import { buildPairingUrl } from "./pairing";

describe("buildPairingUrl (fork)", () => {
  it("builds a bare backend URL when the code is empty", () => {
    expect(buildPairingUrl("100.95.60.35:3773", "")).toBe("http://100.95.60.35:3773/");
    expect(buildPairingUrl("agent-hub.example.ts.net", " ")).toBe(
      "https://agent-hub.example.ts.net/",
    );
  });
});
