import type { AuthClientPresentationMetadata } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiGroupClient } from "../rpc/http.ts";
import { bootstrapRemoteBearerSession } from "./remote.ts";

const TAILSCALE_PAIRING_TIMEOUT_MS = 10_000;

/** Fork patch 7: a pairing code the environment issues to this tailnet device. */
const requestRemoteTailscalePairing = Effect.fn(
  "clientRuntime.authorization.requestRemoteTailscalePairing",
)(function* (input: { readonly httpBaseUrl: string; readonly timeoutMs?: number }) {
  const client = yield* makeEnvironmentHttpApiGroupClient(input.httpBaseUrl, "auth");
  return yield* executeEnvironmentHttpRequest(
    environmentEndpointUrl(input.httpBaseUrl, "/api/auth/tailscale-pairing"),
    input.timeoutMs ?? TAILSCALE_PAIRING_TIMEOUT_MS,
    client.tailscalePairing(),
  );
});

/**
 * Pairs over Tailscale and redeems the code like a typed one. Fails when the
 * environment does not offer it or refuses this device; callers then fall
 * back to asking for a code.
 */
export const pairRemoteBearerOverTailscale = Effect.fn(
  "clientRuntime.authorization.pairRemoteBearerOverTailscale",
)(function* (input: {
  readonly httpBaseUrl: string;
  readonly clientMetadata?: AuthClientPresentationMetadata;
}) {
  const issued = yield* requestRemoteTailscalePairing({ httpBaseUrl: input.httpBaseUrl });
  return yield* bootstrapRemoteBearerSession({
    httpBaseUrl: input.httpBaseUrl,
    credential: issued.credential,
    ...(input.clientMetadata ? { clientMetadata: input.clientMetadata } : {}),
  });
});
