import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateSidebarPillView,
  type ProviderUpdateCandidate,
} from "./ProviderUpdateLaunchNotification.logic";

const checkedAt = "2026-04-23T10:00:00.000Z";

const driver = (value: string) => ProviderDriverKind.make(value);
const instanceId = (value: string) => ProviderInstanceId.make(value);

function provider(input: {
  readonly driver: ReturnType<typeof ProviderDriverKind.make>;
  readonly instanceId?: ReturnType<typeof ProviderInstanceId.make>;
  readonly latestVersion?: string | null;
  readonly updateCommand?: string | null;
}): ServerProvider {
  return {
    instanceId: input.instanceId ?? instanceId(String(input.driver)),
    driver: input.driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "latestVersion" in input ? input.latestVersion : "1.1.0",
      updateCommand: "updateCommand" in input ? input.updateCommand : "npm install -g provider",
      canUpdate: true,
      checkedAt,
      message: "Update available.",
    },
  };
}

describe("provider update launch notification logic (fork)", () => {
  it("names OMP and keeps it apart from Pi although both run on the Pi driver", () => {
    const pi = provider({ driver: driver("pi"), latestVersion: "0.81.0" });
    const omp = {
      ...provider({
        driver: driver("pi"),
        instanceId: instanceId("omp"),
        latestVersion: "18.8.0",
        updateCommand: "npm install -g @oh-my-pi/pi-coding-agent",
      }),
      displayName: "OMP",
    };

    const candidates = collectProviderUpdateCandidates([pi, omp]);
    expect(candidates.map((candidate) => candidate.instanceId).toSorted()).toEqual(["omp", "pi"]);
    expect(canOneClickUpdateProviderCandidate(omp as ProviderUpdateCandidate, [pi, omp])).toBe(
      true,
    );
    expect(
      getProviderUpdateSidebarPillView([
        pi,
        {
          ...omp,
          updateState: {
            status: "running",
            startedAt: checkedAt,
            finishedAt: null,
            message: null,
            output: null,
          },
        },
      ])?.title,
    ).toBe("Updating OMP");
  });

  it("names each ACP Registry agent and offers its own update", () => {
    const acp = (id: string, name: string) => ({
      ...provider({
        driver: driver("acpRegistry"),
        instanceId: instanceId(`acpRegistry_${id}`),
        updateCommand: `${id} update`,
      }),
      displayName: name,
    });
    const kimi = acp("kimi", "Kimi");
    const qoder = acp("qoder", "Qoder");

    const candidates = collectProviderUpdateCandidates([kimi, qoder]);
    expect(candidates.map((candidate) => candidate.displayName).toSorted()).toEqual([
      "Kimi",
      "Qoder",
    ]);
    expect(canOneClickUpdateProviderCandidate(kimi as ProviderUpdateCandidate, [kimi, qoder])).toBe(
      true,
    );
    expect(
      getProviderUpdateSidebarPillView([
        {
          ...kimi,
          updateState: {
            status: "running",
            startedAt: checkedAt,
            finishedAt: null,
            message: null,
            output: null,
          },
        },
        qoder,
      ])?.title,
    ).toBe("Updating Kimi");
  });
});
