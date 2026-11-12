import { Extensions } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ExtensionsRequest } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Fork patch 30: reads or changes the extensions of one environment. */
export const requestExtensions = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:extensions:request",
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly request: ExtensionsRequest;
  }) => Extensions.request(input.environmentId, input.request),
});
