import { describe, expect, it } from "vite-plus/test";

import { resolveInterfaceSwitch, selectionAfterExtensionList } from "./interfaceSwitch";

describe("resolveInterfaceSwitch", () => {
  it("offers no switch while no extension has an interface", () => {
    expect(resolveInterfaceSwitch([], null)).toBeNull();
    expect(resolveInterfaceSwitch([], "board")).toBeNull();
  });

  it("steps from the standard interface through each offered one and back", () => {
    expect(resolveInterfaceSwitch(["board", "tower"], null)).toEqual({
      activeId: null,
      nextId: "board",
    });
    expect(resolveInterfaceSwitch(["board", "tower"], "board")).toEqual({
      activeId: "board",
      nextId: "tower",
    });
    expect(resolveInterfaceSwitch(["board", "tower"], "tower")).toEqual({
      activeId: "tower",
      nextId: null,
    });
  });

  it("draws the standard interface when the chosen one is not offered", () => {
    expect(resolveInterfaceSwitch(["board"], "tower")).toEqual({ activeId: null, nextId: "board" });
  });
});

describe("selectionAfterExtensionList", () => {
  const extensions = [
    { id: "board", enabled: true },
    { id: "tower", enabled: false },
  ];

  it("keeps a choice whose extension is on", () => {
    expect(selectionAfterExtensionList("board", extensions)).toBe("board");
  });

  it("drops a choice whose extension is off or gone", () => {
    expect(selectionAfterExtensionList("tower", extensions)).toBeNull();
    expect(selectionAfterExtensionList("radar", extensions)).toBeNull();
    expect(selectionAfterExtensionList(null, extensions)).toBeNull();
  });
});
