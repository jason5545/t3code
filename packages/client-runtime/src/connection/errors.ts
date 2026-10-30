import {
  type ClientConnectionMethod,
  type EnvironmentAuthInvalidReason,
  type EnvironmentId,
  EnvironmentOperationForbiddenError,
} from "@t3tools/contracts";
import type { RelayProtectedError } from "@t3tools/contracts/relay";
import * as Schema from "effect/Schema";
import type { ManagedRelayClientError } from "../relay/managedRelay.ts";
import { dpopFailureMessage, relayProtectedErrorMessage } from "../relay/errorPresentation.ts";
import type { RemoteEnvironmentAuthError } from "../authorization/remote.ts";
import { NETWORK_BLOCKING_HINT } from "../errors/network.ts";
import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
} from "./model.ts";
import { PAIRING_REDIRECT_DETAIL } from "./pairingFailureText.ts";
import { SESSION_EXPIRED_DETAIL, SIGNED_OUT_DETAIL } from "./sessionEndedText.ts";

export function profileMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connection profile ${connectionId} is unavailable.`,
    hop: "device",
  });
}

export function credentialMissingError(connectionId: string): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "authentication",
    detail: `Connection credential ${connectionId} is unavailable.`,
    hop: "device",
  });
}

export function environmentMismatchError(input: {
  readonly expected: EnvironmentId;
  readonly actual: EnvironmentId;
}): ConnectionBlockedError {
  return new ConnectionBlockedError({
    reason: "configuration",
    detail: `Connected environment ${input.actual} does not match ${input.expected}.`,
  });
}

function relayProtectedError(error: RelayProtectedError): ConnectionAttemptError {
  const detail = relayProtectedErrorMessage(error);
  const traceId = error.traceId;
  switch (error._tag) {
    case "RelayAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail,
        traceId,
        hop: "relay",
        ...(error.dpopFailureReason === "time_window" ? { failureCause: "clock_skew" } : {}),
      });
    case "RelayEnvironmentLinkProofExpiredError":
    case "RelayAgentActivityPublishProofExpiredError":
    case "RelayAgentActivityPublishProofInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail,
        traceId,
        hop: "relay",
      });
    case "RelayEnvironmentConnectNotAuthorizedError":
      // A host swapping in a new tunnel leaves its allocation unready until
      // the tunnel is up, and nothing on the client changes when it is.
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return new ConnectionTransientError({
          reason: "endpoint-unavailable",
          detail,
          traceId,
          hop: "tunnel",
          failureCause: "tunnel_pending",
        });
      }
      if (error.reason === "endpoint_provider_not_managed") {
        return new ConnectionBlockedError({
          reason: "permission",
          detail,
          traceId,
          hop: "tunnel",
          failureCause: "tunnel_not_enabled",
        });
      }
      return new ConnectionBlockedError({
        reason: "permission",
        detail,
        traceId,
        hop: "relay",
        ...(error.reason === "environment_link_not_found" ? { failureCause: "not_linked" } : {}),
      });
    case "RelayEnvironmentLinkProofInvalidError":
    case "RelayEnvironmentLinkLimitExceededError":
      return new ConnectionBlockedError({ reason: "permission", detail, traceId, hop: "relay" });
    case "RelayEnvironmentEndpointTimedOutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail,
        traceId,
        hop: "tunnel",
        failureCause: "timeout",
      });
    case "RelayEnvironmentEndpointUnavailableError": {
      const endpointFailure =
        error.endpointFailure ??
        (error.reason === "endpoint_response_invalid" ? "invalid_response" : undefined);
      return new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail,
        traceId,
        // The tunnel carried the request when T3 Code is what failed to answer.
        hop:
          endpointFailure === "origin_unreachable" || endpointFailure === "invalid_response"
            ? "server"
            : "tunnel",
        via: "relay",
        ...(endpointFailure ? { failureCause: endpointFailure } : {}),
        ...(error.endpointStatus ? { httpStatus: error.endpointStatus } : {}),
      });
    }
    case "RelayEnvironmentLinkUnavailableError":
      return new ConnectionTransientError({
        reason: "endpoint-unavailable",
        detail,
        traceId,
        hop: "tunnel",
      });
    case "RelayEnvironmentLinkFailedError":
    case "RelayInternalError":
      return new ConnectionTransientError({
        reason: "relay-unavailable",
        detail,
        traceId,
        hop: "relay",
        failureCause: "relay_error",
      });
  }
}

export function mapManagedRelayError(error: ManagedRelayClientError): ConnectionAttemptError {
  switch (error._tag) {
    case "ManagedRelayRequestFailedError":
      if (error.relayError) {
        return relayProtectedError(error.relayError);
      }
      return new ConnectionTransientError({
        reason: "relay-unavailable",
        detail: error.message,
        hop: "relay",
        // A status means the relay answered, so this device did reach it.
        ...(error.status !== undefined
          ? { httpStatus: error.status, failureCause: "relay_error" }
          : {}),
        ...(error.traceId ? { traceId: error.traceId } : {}),
      });
    case "ManagedRelayRequestTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: error.message,
        hop: "relay",
      });
    case "ManagedRelayUrlInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: error.message,
        hop: "relay",
      });
    case "ManagedRelayAccessTokenScopesUnexpectedError":
      return new ConnectionBlockedError({
        reason: "permission",
        detail: error.message,
        hop: "relay",
      });
    case "ManagedRelayDpopKeyLoadError":
    case "ManagedRelayTokenProofCreationError":
    case "ManagedRelayRequestProofCreationError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: error.message,
        hop: "device",
      });
  }
}

/** Fork patch 6: a session that ran out or was signed out says so. */
const credentialRejectedDetail = (reason: EnvironmentAuthInvalidReason) =>
  reason === "session_expired"
    ? SESSION_EXPIRED_DETAIL
    : reason === "session_revoked"
      ? SIGNED_OUT_DETAIL
      : "The environment credential is invalid.";

const isOperationForbidden = Schema.is(EnvironmentOperationForbiddenError);

/** Fork patch 6: the environment will not pair this device over Tailscale because it was signed out. */
export const isSignedOutRefusal = (error: unknown): error is EnvironmentOperationForbiddenError =>
  isOperationForbidden(error) && error.reason === "tailscale_pairing_revoked";

/**
 * Fork patch 7: the environment does not pair this device without a code, either refusing it
 * or, on a server without the fork, lacking the endpoint. The server gives no finer reason.
 */
export const isCodelessPairingRefusal = (error: RemoteEnvironmentAuthError): boolean =>
  (isOperationForbidden(error) && error.reason === "tailscale_pairing_refused") ||
  (error._tag === "RemoteEnvironmentAuthUndeclaredStatusError" && error.status === 404);

export function mapRemoteEnvironmentError(
  error: RemoteEnvironmentAuthError,
  connectionMethod: ClientConnectionMethod = "direct",
): ConnectionAttemptError {
  const networkHint = connectionMethod === "relay" ? ` ${NETWORK_BLOCKING_HINT}` : "";
  // Over T3 Connect the relay already reached the host, so a request that never
  // arrives was blocked between this device and the tunnel.
  const unreachableHop = connectionMethod === "relay" ? "tunnel" : "server";
  const via = connectionMethod === "relay" ? "relay" : "direct";
  switch (error._tag) {
    case "EnvironmentAuthInvalidError":
      return new ConnectionBlockedError({
        reason: "authentication",
        detail: credentialRejectedDetail(error.reason),
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "EnvironmentScopeRequiredError":
    case "EnvironmentOperationForbiddenError":
      if (isSignedOutRefusal(error)) {
        return new ConnectionBlockedError({
          reason: "authentication",
          detail: SIGNED_OUT_DETAIL,
          traceId: error.traceId,
          hop: "server",
          via,
        });
      }
      return new ConnectionBlockedError({
        reason: "permission",
        detail: "The environment credential does not grant the required access.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "EnvironmentRequestInvalidError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment rejected the authentication request.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "EnvironmentResourceNotFoundError":
      return new ConnectionBlockedError({
        reason: "configuration",
        detail: "The environment endpoint could not be found.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthTimeoutError":
      return new ConnectionTransientError({
        reason: "timeout",
        detail: `${error.message}${networkHint}`,
        hop: unreachableHop,
        via,
      });
    case "RemoteEnvironmentAuthFetchError":
      return new ConnectionTransientError({
        reason: "network",
        detail: `${error.message}${networkHint}`,
        hop: unreachableHop,
        via,
      });
    case "EnvironmentInternalError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "The environment could not authorize the connection.",
        traceId: error.traceId,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      // Fork patch 7: only a client that refuses redirects sees one; a 3xx went nowhere.
      if (error.status >= 300 && error.status < 400) {
        return new ConnectionBlockedError({
          reason: "configuration",
          detail: PAIRING_REDIRECT_DETAIL,
          hop: "server",
          via,
        });
      }
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      });
    case "RemoteEnvironmentAuthInvalidJsonError":
      return new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: error.message,
        hop: "server",
        via,
      });
  }
}

/**
 * An older environment server reports a DPoP clock failure as the same generic
 * invalid-credential response as other failures, so keep the compatibility hint
 * cautious when the server omits the category.
 */
export function mapRemoteDpopEnvironmentError(
  error: RemoteEnvironmentAuthError,
): ConnectionAttemptError {
  if (error._tag === "EnvironmentAuthInvalidError" && error.reason === "invalid_credential") {
    return new ConnectionBlockedError({
      reason: "authentication",
      detail: dpopFailureMessage("The environment credential is invalid.", error.dpopFailureReason),
      traceId: error.traceId,
      hop: "server",
      via: "relay",
      ...(error.dpopFailureReason === "time_window" ? { failureCause: "clock_skew" } : {}),
    });
  }
  return mapRemoteEnvironmentError(error, "relay");
}
