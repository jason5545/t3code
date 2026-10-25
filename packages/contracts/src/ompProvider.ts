import { ProviderDriverKind, type ProviderInstanceConfig } from "./providerInstance.ts";

/**
 * The instance Settings → Providers adds for OMP: the Pi driver with its own CLI configuration.
 * Not a default, since a server without `omp` would show it as not installed.
 */
export const OMP_PROVIDER_INSTANCE: ProviderInstanceConfig = {
  driver: ProviderDriverKind.make("pi"),
  displayName: "OMP",
  enabled: true,
  config: { binaryPath: "omp", launchArgs: "", customModels: [] },
};

const OMP_MARK_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='10 13 44 44'><defs><linearGradient id='omp' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#ed4abf'/><stop offset='.5' stop-color='#9b4dff'/><stop offset='1' stop-color='#5ad8e6'/></linearGradient></defs><path fill='url(#omp)' d='M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z'/></svg>";

/**
 * OMP's π mark from omp.sh. The server sends it as an OMP instance's `iconUrl`, so a
 * client that is only handed a driver and an icon can still tell OMP apart from Pi.
 */
export const OMP_ICON_URL = `data:image/svg+xml,${encodeURIComponent(OMP_MARK_SVG)}`;

/**
 * The glyph an instance shows. OMP runs on the Pi driver but has its own mark: a Pi
 * instance named OMP (the default instance's name) or carrying `OMP_ICON_URL` is OMP.
 */
export function providerIconKind(
  driver: string | null | undefined,
  displayName: string | null | undefined,
  iconUrl?: string | null,
): string | null | undefined {
  if (driver !== "pi") return driver;
  return iconUrl === OMP_ICON_URL || /^omp\b/iu.test(displayName?.trim() ?? "") ? "omp" : driver;
}
