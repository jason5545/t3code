import { describe, expect, it } from "vite-plus/test";

import { createExtensionHost, type Extension } from "./extensions.ts";

interface Points {
  readonly words: string;
  readonly numbers: number;
}

const extension = (id: string, contributes: Extension<Points>["contributes"]) => ({
  id,
  title: id,
  patch: 1,
  contributes,
});

describe("createExtensionHost", () => {
  it("lists a point's contributions in manifest order, as one stable array", () => {
    const host = createExtensionHost<Points>([
      extension("first", { words: ["a", "b"] }),
      extension("second", { numbers: [1] }),
      extension("third", { words: ["c"] }),
    ]);

    expect(host.list("words")).toEqual(["a", "b", "c"]);
    expect(host.list("numbers")).toEqual([1]);
    expect(host.list("words")).toBe(host.list("words"));
    expect(host.extensions.map(({ id }) => id)).toEqual(["first", "second", "third"]);
  });

  it("refuses a manifest that lists an extension twice", () => {
    expect(() =>
      createExtensionHost<Points>([extension("same", {}), extension("same", {})]),
    ).toThrow('Extension "same" is listed twice.');
  });
});
