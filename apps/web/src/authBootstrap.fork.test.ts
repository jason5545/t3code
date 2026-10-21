import {
  EnvironmentAuthInvalidError,
  type AuthBrowserSessionResult,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { installEnvironmentHttpTest } from "../test/environmentHttpTest";
import { __setPrimaryHttpRunnerForTests } from "./lib/runtime";

// Harness mirrors authBootstrap.test.ts so the Tailscale cases stay out of the upstream file.
type TestWindow = {
  location: URL;
  history: {
    state: unknown;
    replaceState: (_data: unknown, _unused: string, url?: string) => void;
  };
};

const REMOTE_AUTH = {
  policy: "remote-reachable",
  bootstrapMethods: ["one-time-token"],
  sessionMethods: ["browser-session-cookie", "bearer-access-token"],
  sessionCookieName: "t3_session",
} as const;

const SESSION_EXPIRES_AT = DateTime.makeUnsafe("2026-04-05T00:00:00.000Z");
const unauthenticatedSession = (auth: AuthSessionState["auth"]): AuthSessionState => ({
  authenticated: false,
  auth,
});

const authenticatedSession = (auth: AuthSessionState["auth"]): AuthSessionState => ({
  authenticated: true,
  auth,
  sessionMethod: "browser-session-cookie",
  expiresAt: SESSION_EXPIRES_AT,
});

const browserSession = (scopes: AuthBrowserSessionResult["scopes"]): AuthBrowserSessionResult => ({
  authenticated: true,
  scopes,
  sessionMethod: "browser-session-cookie",
  expiresAt: SESSION_EXPIRES_AT,
});

function installTestBrowser(url: string) {
  const testWindow: TestWindow = {
    location: new URL(url),
    history: {
      state: null,
      replaceState: (data, _unused, nextUrl) => {
        testWindow.history.state = data;
        if (nextUrl !== undefined) {
          testWindow.location = new URL(nextUrl, testWindow.location.href);
        }
      },
    },
  };

  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("document", { title: "T3 Code" });

  return testWindow;
}

function sequence<A>(...values: ReadonlyArray<A>) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

let disposeHttpTest: (() => Promise<void>) | undefined;

async function installAuthApi(input: {
  readonly session?: () => AuthSessionState;
  readonly browserSession?: (
    credential: string,
  ) => Effect.Effect<AuthBrowserSessionResult, EnvironmentAuthInvalidError>;
  readonly tailscaleCredential?: string;
}) {
  const testApi = await installEnvironmentHttpTest({
    ...(input.session ? { session: () => Effect.succeed(input.session!()) } : {}),
    ...(input.browserSession
      ? { browserSession: (payload) => input.browserSession!(payload.credential) }
      : {}),
    ...(input.tailscaleCredential
      ? {
          tailscalePairing: () =>
            Effect.succeed({
              id: "tailscale-link",
              credential: input.tailscaleCredential!,
              expiresAt: SESSION_EXPIRES_AT,
            }),
        }
      : {}),
  });
  disposeHttpTest = testApi.dispose;
  return testApi;
}

describe("resolveInitialServerAuthGateState over Tailscale", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    installTestBrowser("http://localhost/");
  });

  afterEach(async () => {
    await disposeHttpTest?.();
    disposeHttpTest = undefined;
    const { __resetServerAuthBootstrapForTests } = await import("./environments/primary");
    __resetServerAuthBootstrapForTests();
    __setPrimaryHttpRunnerForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the pairing screen when the server will not pair over Tailscale", async () => {
    const testApi = await installAuthApi({ session: () => unauthenticatedSession(REMOTE_AUTH) });
    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "requires-auth",
      auth: REMOTE_AUTH,
    });
    expect(testApi.calls.tailscalePairing).toBe(1);
    expect(testApi.calls.browserSession).toEqual([]);
  });

  it("signs in over Tailscale when there is no credential and the server allows it", async () => {
    const testApi = await installAuthApi({
      session: sequence(unauthenticatedSession(REMOTE_AUTH), authenticatedSession(REMOTE_AUTH)),
      browserSession: () => Effect.succeed(browserSession(["orchestration:read"])),
      tailscaleCredential: "tailscale-code",
    });
    const { resolveInitialServerAuthGateState } = await import("./environments/primary");

    await expect(resolveInitialServerAuthGateState()).resolves.toEqual({
      status: "authenticated",
    });
    expect(testApi.calls.browserSession).toEqual([{ credential: "tailscale-code" }]);
  });
});
