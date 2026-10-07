export const FORK_REPOSITORY = "jason5545/t3code";

/** Fail closed: local development signing is only for this fork's nightlies. */
export function resolveDevelopmentSigningConfig(input: {
  readonly mode: string;
  readonly identity: string;
  readonly repository: string;
  readonly platform: string;
  readonly version: string;
  readonly signed: boolean;
}) {
  if (input.mode === "distribution") return undefined;
  if (input.mode !== "development") throw new Error("Unsupported macOS signing mode.");
  if (input.platform !== "mac" || !input.signed) {
    throw new Error("Development signing requires a signed macOS build.");
  }
  if (input.repository !== FORK_REPOSITORY || !/^[^-+]+-nightly\./u.test(input.version)) {
    throw new Error("Development signing is restricted to jason5545/t3code nightly builds.");
  }
  if (!/^[A-Fa-f0-9]{40}$/u.test(input.identity)) {
    throw new Error("Set T3CODE_MACOS_DEVELOPMENT_IDENTITY to a certificate SHA-1 hash.");
  }
  return {
    identity: input.identity.toUpperCase(),
    appId: "com.jason5545.t3code.nightly",
    productName: "T3 Code Jason (Nightly)",
  } as const;
}
