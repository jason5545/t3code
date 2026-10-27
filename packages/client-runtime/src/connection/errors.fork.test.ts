import { EnvironmentAuthInvalidError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { mapRemoteEnvironmentError } from "./errors.ts";

describe("a refused session credential", () => {
  it.each([
    ["invalid_credential", "The environment credential is invalid."],
    ["session_expired", "The sign-in expired. Pair this device again."],
    ["session_revoked", "This device was signed out."],
  ] as const)("reports %s as its own message", (reason, detail) => {
    const mapped = mapRemoteEnvironmentError(
      new EnvironmentAuthInvalidError({ code: "auth_invalid", reason, traceId: "trace-1" }),
    );
    expect(mapped).toMatchObject({ reason: "authentication", detail, traceId: "trace-1" });
  });
});
