import { Extensions } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ExtensionCallRequest, ExtensionsRequest } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

/** Fork patch 30: reads or changes the extensions of one environment. */
export const requestExtensions = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:extensions:request",
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly request: ExtensionsRequest;
  }) => Extensions.request(input.environmentId, input.request),
});

/**
 * Fork patch 30: calls a method of an extension's server part. Built-in web code may name any
 * connected environment; an installed web part reaches only the primary one, through `t3.call`.
 */
export const callExtension = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:extensions:call",
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly request: ExtensionCallRequest;
  }) => Extensions.call(input.environmentId, input.request),
});
