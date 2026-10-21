import {
  DEFAULT_PROVIDER_INSTANCES,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { providerClients } from "./providerDriverMeta";

const PI = ProviderDriverKind.make("pi");
const OMP = ProviderDriverKind.make("omp");
const OMP_DEFAULT_CONFIG = DEFAULT_PROVIDER_INSTANCES[ProviderInstanceId.make("omp")]!.config as
  | Record<string, unknown>
  | undefined;

/**
 * The creation wizard keys its choices and drafts by driver kind. OMP is a preset of the
 * Pi driver, not another protocol driver, so it is listed under its own key, `omp`, and
 * `providerInstancePreset` maps that key back to the Pi driver when the instance is saved.
 */
const definitions = providerClients.definitions.flatMap((definition) =>
  definition.driverKind === PI
    ? [definition, { ...definition, driverKind: OMP, label: "OMP" }]
    : [definition],
);

export const providerInstanceClients = {
  definitions,
  get: (choice: ProviderDriverKind) =>
    definitions.find((definition) => definition.driverKind === choice),
};

/** The driver and starting configuration of an instance created from a wizard choice. */
export function providerInstancePreset(choice: ProviderDriverKind): {
  readonly driver: ProviderDriverKind;
  readonly defaultConfig?: Record<string, unknown> | undefined;
} {
  return choice === OMP ? { driver: PI, defaultConfig: OMP_DEFAULT_CONFIG } : { driver: choice };
}

/** A choice's config draft over its preset's defaults; other choices keep their draft as is. */
export function presetConfigDraft(
  choice: ProviderDriverKind,
  draft: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const { defaultConfig } = providerInstancePreset(choice);
  return defaultConfig ? { ...defaultConfig, ...draft } : draft;
}
