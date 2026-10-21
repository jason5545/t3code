import { ProviderInstanceId } from "@t3tools/contracts";
import { AcpRegistrySettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { buildCheckedAcpRegistrySnapshot } from "./driver.ts";
import { acpRegistryMaintenanceCapabilities } from "./localCommandUpdates.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const identity = {
  instanceId: ProviderInstanceId.make("acpRegistry_test"),
  displayName: "Test ACP",
  accentColor: undefined,
  continuationKey: "acpRegistry:instance:acpRegistry_test",
};
const noSessionManagement = {
  canList: false,
  canLoad: false,
  canResume: false,
  canLogout: false,
  canDelete: false,
  canConfigureProviders: false,
} as const;

describe("local ACP maintenance", () => {
  const readyProbe = (agentVersion?: string) => ({
    probe: {
      instanceId: identity.instanceId,
      ready: true as const,
      icon: null,
      authMethods: [],
      models: [],
      currentModelId: null,
      configOptions: [],
      sessionManagement: noSessionManagement,
    },
    ...(agentVersion === undefined ? {} : { agentVersion }),
    slashCommands: [],
    skills: [],
  });

  it("reports the version a local agent advertises in ACP initialize", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ source: "local", commandPath: "/opt/perch-acp" }),
      checkedAt: "2026-10-18T10:00:00.000Z",
      inspection: {
        status: "ready",
        agentId: "/opt/perch-acp",
        version: null,
        distribution: "local",
      },
      probe: readyProbe("2.4.110"),
    });
    expect(provider.version).toBe("2.4.110");
  });

  it("keeps the registry version over the one a registry agent advertises", () => {
    const provider = buildCheckedAcpRegistrySnapshot({
      ...identity,
      settings: decodeSettings({ agentId: "test-agent" }),
      checkedAt: "2026-10-18T10:00:00.000Z",
      inspection: { status: "ready", agentId: "test-agent", version: "1.0.0", distribution: "npx" },
      probe: readyProbe("9.9.9"),
    });
    expect(provider.version).toBe("1.0.0");
  });

  it("declares nothing unless a local command opts in", () => {
    expect(
      acpRegistryMaintenanceCapabilities({
        instanceId: identity.instanceId,
        settings: decodeSettings({ source: "local", commandPath: "/opt/perch-acp" }),
      }),
    ).toBeNull();
    expect(
      acpRegistryMaintenanceCapabilities({
        instanceId: identity.instanceId,
        settings: decodeSettings({
          agentId: "test-agent",
          npmPackageName: "test-agent",
          updateCommand: ["/opt/update"],
        }),
      }),
    ).toBeNull();
  });

  it("runs the configured update command under a per-instance lock", () => {
    const maintenance = acpRegistryMaintenanceCapabilities({
      instanceId: identity.instanceId,
      settings: decodeSettings({
        source: "local",
        commandPath: "/Users/me/.kimi-code/bin/kimi",
        commandArgs: ["acp"],
        npmPackageName: "@moonshot-ai/kimi-code",
        updateCommand: ["/Users/me/.kimi-code/bin/kimi", "update", "-y"],
      }),
      environment: { KIMI_HOME: "/Users/me/.kimi-code" },
    });
    expect(maintenance).toMatchObject({
      provider: "acpRegistry",
      packageName: "@moonshot-ai/kimi-code",
      update: {
        executable: "/Users/me/.kimi-code/bin/kimi",
        args: ["update", "-y"],
        lockKey: "local:acpRegistry_test",
        env: { KIMI_HOME: "/Users/me/.kimi-code" },
      },
    });
    expect(maintenance?.update?.command).toBe("/Users/me/.kimi-code/bin/kimi update -y");
  });

  it("checks for updates without offering one when only the package is known", () => {
    const maintenance = acpRegistryMaintenanceCapabilities({
      instanceId: identity.instanceId,
      settings: decodeSettings({
        source: "local",
        commandPath: "/opt/qodercli",
        npmPackageName: "@qoder-ai/qodercli",
      }),
    });
    expect(maintenance).toMatchObject({ packageName: "@qoder-ai/qodercli", update: null });
  });
});
