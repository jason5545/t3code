import type { ExtensionCallRequest } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { bindExtensionCall } from "./extensionCall";

describe("bindExtensionCall", () => {
  it("sends the web part's own id whatever it is called with", async () => {
    const sent: Array<ExtensionCallRequest> = [];
    const call = bindExtensionCall("hello-world", () => async (request) => {
      sent.push(request);
      return request.method === "ping"
        ? { ok: true, value: { pong: request.input } }
        : { ok: false, error: `"hello-world" has no method "${request.method}".` };
    });
    await expect(call("ping", { id: "other-extension" })).resolves.toEqual({
      pong: { id: "other-extension" },
    });
    await expect(call("missing")).rejects.toThrow('"hello-world" has no method "missing".');
    expect(sent.map(({ id }) => id)).toEqual(["hello-world", "hello-world"]);
  });

  it("rejects while the server is not connected", async () => {
    await expect(bindExtensionCall("hello-world", () => null)("ping")).rejects.toThrow(
      "The server is not connected.",
    );
    await expect(bindExtensionCall("hello-world", () => async () => null)("ping")).rejects.toThrow(
      "The server is not connected.",
    );
  });
});
