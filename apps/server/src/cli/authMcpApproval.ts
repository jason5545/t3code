import type * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import { Flag } from "effect/cli";

import { encodeMcpApprovalSubject } from "../auth/mcpApprovalCode.ts";
import { DurationFromString } from "./config.ts";

/** Fork patch 5: `t3 auth pairing create` options that make an MCP-only approval code. */
export const mcpApprovalCodeFlags = {
  sessionTtl: Flag.String("session-ttl").pipe(
    Flag.withSchema(DurationFromString),
    Flag.withDescription(
      "How long MCP agent sign-ins approved with this code last, for example `180d`. The code then only approves MCP sign-ins.",
    ),
    Flag.optional,
  ),
  reusable: Flag.Boolean("reusable").pipe(
    Flag.withDescription(
      "Approve MCP agent sign-ins until the code expires or is revoked, instead of once. The code then only approves MCP sign-ins.",
    ),
    Flag.withDefault(false),
  ),
};

/** The pairing link subject for a new code: upstream's, unless an MCP-only option is set. */
export const pairingLinkSubject = (flags: {
  readonly sessionTtl: Option.Option<Duration.Duration>;
  readonly reusable: boolean;
}): string =>
  Option.isSome(flags.sessionTtl) || flags.reusable
    ? encodeMcpApprovalSubject({
        ...(Option.isSome(flags.sessionTtl) ? { sessionTtl: flags.sessionTtl.value } : {}),
        reusable: flags.reusable,
      })
    : "one-time-token";
