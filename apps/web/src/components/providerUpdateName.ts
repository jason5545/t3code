import { PROVIDER_DISPLAY_NAMES, providerIconKind, type ServerProvider } from "@t3tools/contracts";

/**
 * OMP runs on the Pi driver and every ACP Registry instance is its own agent, so update
 * prompts group and name them apart instead of by driver alone.
 */
export function providerUpdateKind(
  provider: Pick<ServerProvider, "driver" | "displayName" | "instanceId">,
): string {
  if (provider.driver === "acpRegistry") return `acpRegistry:${provider.instanceId}`;
  return providerIconKind(provider.driver, provider.displayName) ?? provider.driver;
}

export function providerUpdateName(
  provider: Pick<ServerProvider, "driver" | "displayName">,
): string {
  const named = provider.displayName?.trim();
  if (provider.driver === "acpRegistry") return named || "ACP Registry";
  if (providerIconKind(provider.driver, provider.displayName) === "omp") return named || "OMP";
  return PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
}
