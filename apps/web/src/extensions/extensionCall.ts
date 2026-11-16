import type { ExtensionCallRequest, ExtensionCallResult } from "@t3tools/contracts";

/** Sends a call to the primary environment; null while it is not connected. */
export type ExtensionCallSender = (
  request: ExtensionCallRequest,
) => Promise<ExtensionCallResult | null>;

/**
 * Fork patch 30: an installed web part's `t3.call`. The id is the web part's own, fixed here,
 * so the API offers no way to name another extension. Resolves with the handler's value and
 * rejects with the server's reason.
 */
export const bindExtensionCall =
  (id: string, sender: () => ExtensionCallSender | null) =>
  async (method: string, input?: unknown): Promise<unknown> => {
    if (typeof method !== "string") throw new TypeError("t3.call takes a method name first.");
    const send = sender();
    const result = send === null ? null : await send({ id, method, input });
    if (result === null) throw new Error("The server is not connected.");
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
