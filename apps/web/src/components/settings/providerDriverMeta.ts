import {
  DEFAULT_PROVIDER_INSTANCES,
  ProviderInstanceId,
  AntigravitySettings,
  ClaudeSettings,
  CodexSettings,
  ProviderDriverKind,
} from "@t3tools/contracts";
import { acpRegistryClient } from "@t3tools/provider-acp-registry/client";
import {
  makeProviderClientRegistry,
  type ProviderClientDefinition,
} from "@t3tools/provider-core/client";
import { cursorClient } from "@t3tools/provider-cursor/client";
import { grokClient } from "@t3tools/provider-grok/client";
import { museClient } from "@t3tools/provider-muse/client";
import { openCodeClient } from "@t3tools/provider-opencode/client";
import { piClient } from "@t3tools/provider-pi/client";

/** The provider client definitions this web build ships, in presentation order. */
export const providerClients = makeProviderClientRegistry([
  {
    driverKind: ProviderDriverKind.make("codex"),
    label: "Codex",
    settingsSchema: CodexSettings,
  },
  {
    driverKind: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    settingsSchema: ClaudeSettings,
  },
  cursorClient,
  grokClient,
  openCodeClient,
  {
    driverKind: ProviderDriverKind.make("antigravity"),
    label: "Antigravity",
    settingsSchema: AntigravitySettings,
  },
  museClient,
  piClient,
  acpRegistryClient,
]);

/** Creation presets are instance choices, not additional protocol drivers. */
export interface ProviderInstanceOption extends ProviderClientDefinition {
  /** Key the creation wizard selects and keys its drafts by; `driverKind` is the real driver. */
  readonly value: ProviderDriverKind;
  readonly defaultConfig?: Record<string, unknown>;
}

export const PROVIDER_INSTANCE_OPTIONS: readonly ProviderInstanceOption[] =
  providerClients.definitions.flatMap((definition) => {
    const option = { ...definition, value: definition.driverKind };
    return definition.driverKind === "pi"
      ? [
          option,
          {
            ...definition,
            value: ProviderDriverKind.make("omp"),
            label: "OMP",
            defaultConfig: DEFAULT_PROVIDER_INSTANCES[ProviderInstanceId.make("omp")]!
              .config as Record<string, unknown>,
          },
        ]
      : [option];
  });

export function getProviderInstanceOption(value: string): ProviderInstanceOption {
  return (
    PROVIDER_INSTANCE_OPTIONS.find((option) => option.value === value) ??
    PROVIDER_INSTANCE_OPTIONS[0]!
  );
}
