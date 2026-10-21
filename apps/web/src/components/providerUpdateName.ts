import { PROVIDER_DISPLAY_NAMES, providerIconKind, type ServerProvider } from "@t3tools/contracts";

/**
 * OMP runs on the Pi driver but is its own CLI and package, so update prompts
 * group and name it apart from Pi instead of by driver alone.
 */
export function providerUpdateKind(
  provider: Pick<ServerProvider, "driver" | "displayName">,
): string {
  return providerIconKind(provider.driver, provider.displayName) ?? provider.driver;
}

export function providerUpdateName(
  provider: Pick<ServerProvider, "driver" | "displayName">,
): string {
  if (providerUpdateKind(provider) === "omp") {
    return provider.displayName?.trim() || "OMP";
  }
  return PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver;
}
