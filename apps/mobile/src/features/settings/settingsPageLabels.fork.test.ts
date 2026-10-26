import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_PAGE_LABELS } from "./settingsPageLabels";

const source = NodeFS.readFileSync(new URL("./SettingsRouteScreen.tsx", import.meta.url), "utf8");

describe("settings page labels", () => {
  it("covers every row title upstream's Settings list passes to page()", () => {
    const titles = [
      ...source.matchAll(/\b(?:serverPage|page)\(\s*"[^"]+",\s*"[^"]+",\s*"([^"]+)"/g),
    ].map((match) => match[1]!);
    expect(titles.length).toBeGreaterThan(10);
    expect(titles.filter((title) => !(title in SETTINGS_PAGE_LABELS))).toEqual([]);
  });

  it("routes every row through the lookup", () => {
    expect(source).toContain("label: settingsPageLabel(label)");
  });
});
