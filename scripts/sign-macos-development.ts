// @effect-diagnostics nodeBuiltinImport:off - Signing is an electron-builder hook.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import {
  FORK_REPOSITORY,
  resolveDevelopmentSigningConfig,
} from "./lib/fork-development-signing.ts";

/** Uses the existing keychain identity. Never exports or uploads the private key. */
export default async function sign(options: SignOptions): Promise<void> {
  const configuration = resolveDevelopmentSigningConfig({
    mode: process.env.T3CODE_MACOS_SIGNING_MODE ?? "",
    identity: process.env.T3CODE_MACOS_DEVELOPMENT_IDENTITY ?? "",
    repository: process.env.T3CODE_DESKTOP_UPDATE_REPOSITORY ?? "",
    platform: "mac",
    version: process.env.T3CODE_DESKTOP_VERSION ?? "",
    signed: true,
  });
  if (!configuration) throw new Error("Development signing is not configured.");
  const identities = NodeChildProcess.execFileSync(
    "/usr/bin/security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  const identityLine = identities.split("\n").find((line) => line.includes(configuration.identity));
  if (!identityLine?.includes('"Apple Development:')) {
    throw new Error("The selected valid Apple Development identity is not in the local keychain.");
  }
  console.log(`Signing development nightly for ${FORK_REPOSITORY}; not notarized.`);
  const entitlements = NodeURL.fileURLToPath(
    new URL("./entitlements.fork-development.plist", import.meta.url),
  );
  await signApplication({
    ...options,
    identity: configuration.identity,
    type: "development",
    platform: "darwin",
    // Electron Builder passes a dispatch placeholder, never use it as identity.
    identityValidation: false,
    preAutoEntitlements: false,
    provisioningProfile: undefined,
    batchCodesignCalls: true,
    optionsForFile: (path, electronVersion) => ({
      ...options.optionsForFile?.(path, electronVersion),
      entitlements,
      hardenedRuntime: true,
    }),
  });
  NodeChildProcess.execFileSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", options.app],
    { stdio: "inherit" },
  );
}
