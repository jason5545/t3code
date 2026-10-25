import { chromium } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";

import * as ServerBrowserPage from "./ServerBrowserPage.ts";

const pngSize = (base64: string) => {
  const header = Buffer.from(base64.slice(0, 32), "base64");
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
};

describe("desktop page snapshots", () => {
  it("capture the scrolled page at device pixels and shrink it in an isolated world", async () => {
    // Raw CDP captures follow the device scale only when it is forced, as a 2x display does.
    const browser = await chromium.launch({
      headless: true,
      args: ["--force-device-scale-factor=2"],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.setContent(`<p style="height: 6000px">sharp</p>`);
      await page.evaluate(`scrollTo(0, 2150);
        globalThis.createImageBitmap = globalThis.OffscreenCanvas = () => {
          throw new Error("Do not use the page's encoder globals");
        }`);
      const cdp = await context.newCDPSession(page);
      const send = vi.spyOn(cdp, "send");

      const { screenshot } = await ServerBrowserPage.snapshot({
        page,
        cdp,
        renderScale: "display",
        consoleEntries: [],
        networkEntries: [],
        actionTimeline: [],
      });

      // A scaled clip asks Chromium to re-render, which a webview behind the app often can't.
      const captures = send.mock.calls.filter(([method]) => method === "Page.captureScreenshot");
      expect(captures.map(([, params]) => params)).toEqual([{ format: "png" }]);
      expect(pngSize(screenshot.data)).toEqual({ width: 1280, height: 800 });
      expect({ width: screenshot.width, height: screenshot.height }).toEqual({
        width: 1280,
        height: 800,
      });
      expect(await page.evaluate("[devicePixelRatio, scrollY]")).toEqual([2, 2150]);
    } finally {
      await browser.close();
    }
  });
});
