import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { AuthEnvironmentScope } from "@t3tools/contracts";

import * as AuthPairingLinks from "../persistence/AuthPairingLinks.ts";
import { decodeMcpApprovalSubject } from "./mcpApprovalCode.ts";
import * as PairingGrantStore from "./PairingGrantStore.ts";

/**
 * Fork patch 5: approval codes made with `--session-ttl` or `--reusable` only
 * approve MCP sign-ins. The layer wraps upstream's `PairingGrantStore` so its
 * `consume` refuses them for device pairing, and offers `use` beside it for
 * MCP approval, which leaves a reusable code unspent.
 */
export class McpApprovalCodes extends Context.Service<
  McpApprovalCodes,
  {
    /** Like `consume` for an MCP approval, except a reusable code is only checked, not spent. */
    readonly use: (
      credential: string,
      input?: { readonly requiredScopes?: ReadonlyArray<AuthEnvironmentScope> },
    ) => Effect.Effect<
      PairingGrantStore.BootstrapGrant,
      PairingGrantStore.BootstrapCredentialError
    >;
  }
>()("t3/auth/McpApprovalCodes") {}

const make = Effect.gen(function* () {
  const store = yield* PairingGrantStore.PairingGrantStore;
  const pairingLinks = yield* AuthPairingLinks.AuthPairingLinkRepository;

  const storedLink = (credential: string) =>
    pairingLinks.getByCredential({ credential }).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError((cause) => new PairingGrantStore.BootstrapCredentialLookupError({ cause })),
    );

  // A reusable code would otherwise pair unlimited clients.
  const consumeForPairing: PairingGrantStore.PairingGrantStore["Service"]["consume"] = (
    credential,
    input,
  ) =>
    storedLink(credential).pipe(
      Effect.flatMap((link) =>
        link !== undefined && decodeMcpApprovalSubject(link.subject) !== undefined
          ? Effect.fail(new PairingGrantStore.UnknownBootstrapCredentialError({}))
          : store.consume(credential, input),
      ),
    );

  const use: McpApprovalCodes["Service"]["use"] = Effect.fn("McpApprovalCodes.use")(
    function* (credential, input) {
      const link = yield* storedLink(credential);
      if (link === undefined || decodeMcpApprovalSubject(link.subject)?.reusable !== true) {
        return yield* store.consume(credential, input);
      }
      const now = yield* DateTime.now;
      if (link.revokedAt !== null) {
        return yield* new PairingGrantStore.UnavailableBootstrapCredentialError({});
      }
      if (link.consumedAt !== null) {
        return yield* new PairingGrantStore.UnknownBootstrapCredentialError({});
      }
      if (DateTime.isGreaterThanOrEqualTo(now, link.expiresAt)) {
        return yield* new PairingGrantStore.ExpiredBootstrapCredentialError({});
      }
      if (link.proofKeyThumbprint !== null) {
        return yield* new PairingGrantStore.BootstrapCredentialProofKeyMismatchError({});
      }
      if (input?.requiredScopes?.some((scope) => !link.scopes.includes(scope))) {
        return yield* new PairingGrantStore.BootstrapCredentialScopeNotGrantedError({});
      }
      return {
        method: link.method,
        scopes: link.scopes,
        subject: link.subject,
        ...(link.label ? { label: link.label } : {}),
        expiresAt: link.expiresAt,
      } satisfies PairingGrantStore.BootstrapGrant;
    },
  );

  return Context.make(PairingGrantStore.PairingGrantStore, {
    ...store,
    consume: consumeForPairing,
  }).pipe(Context.add(McpApprovalCodes, McpApprovalCodes.of({ use })));
});

/** Upstream's store and its repository, with `consume` wrapped; the wrapped store wins the merge. */
export const layer = Layer.effectContext(make).pipe(Layer.provideMerge(PairingGrantStore.layer));
