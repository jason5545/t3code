import { ProviderInstanceId } from "@t3tools/contracts";
import { AcpRegistrySettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { acpRegistryMaintenanceCapabilities } from "./localCommandUpdates.ts";

const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
const instanceId = ProviderInstanceId.make("acpRegistry_test");

describe("local ACP maintenance", () => {
  it("declares nothing unless a local command opts in", () => {
    expect(
      acpRegistryMaintenanceCapabilities({
        instanceId,
        settings: decodeSettings({ source: "local", commandPath: "/opt/perch-acp" }),
      }),
    ).toBeNull();
    expect(
      acpRegistryMaintenanceCapabilities({
        instanceId,
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
      instanceId,
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
      instanceId,
      settings: decodeSettings({
        source: "local",
        commandPath: "/opt/qodercli",
        npmPackageName: "@qoder-ai/qodercli",
      }),
    });
    expect(maintenance).toMatchObject({ packageName: "@qoder-ai/qodercli", update: null });
  });
});
