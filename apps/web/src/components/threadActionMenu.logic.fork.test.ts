import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { getStartedThreadModelChangeBlockReason } from "./ChatView.logic";
import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const state: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [],
};

describe("ephemeral threads (fork patch 11)", () => {
  it("leaves out the menu actions the server refuses on an ephemeral thread", () => {
    const ids = (ephemeral: boolean) =>
      buildThreadActionMenuItems({ ...state, ephemeral }).map((item) => item.id);
    const refused = ["settle", "regenerate-title", "archive"];

    expect(ids(false)).toEqual(expect.arrayContaining(refused));
    expect(ids(true).filter((id) => refused.includes(id))).toEqual([]);
    expect(ids(true)).toEqual(expect.arrayContaining(["rename", "delete"]));
  });

  it("blocks every model but the OMP instance's local ones", () => {
    const omp = ProviderInstanceId.make("omp");
    const codex = ProviderInstanceId.make("codex");
    const providers = [
      {
        instanceId: omp,
        models: [
          { slug: "omlx/local", local: true },
          { slug: "opencode-go/hosted", local: false },
        ],
      },
      { instanceId: codex, models: [{ slug: "gpt-5" }] },
    ] as unknown as Parameters<typeof getStartedThreadModelChangeBlockReason>[0]["providers"];
    const blocked = (instanceId: ProviderInstanceId, model: string) =>
      getStartedThreadModelChangeBlockReason({
        providers,
        hasStartedSession: true,
        supportsProviderSwitchingViaHandoff: true,
        currentModelSelection: { instanceId: omp, model: "omlx/local" },
        nextModelSelection: { instanceId, model },
        ephemeral: true,
      }) !== null;

    expect(blocked(omp, "omlx/local")).toBe(false);
    expect(blocked(omp, "opencode-go/hosted")).toBe(true);
    expect(blocked(codex, "gpt-5")).toBe(true);
  });
});
