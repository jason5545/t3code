import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";

import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateInitialToastView,
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
      getProviderUpdateInitialToastView({
        updateProviders: [omp as ProviderUpdateCandidate],
        oneClickProviders: [omp as ProviderUpdateCandidate],
      }).title,
    ).toBe("Update Available: OMP v18.8.0");
  });
});
