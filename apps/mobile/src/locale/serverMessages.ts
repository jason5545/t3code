import { translateProviderStatusMessage } from "@t3tools/client-runtime/providerStatusMessages";

import { useChinese } from "./autoTranslateRuntime";

/** Shows a server-written provider status message in the interface language. */
export function localizeServerMessage(message: string): string;
export function localizeServerMessage(message: string | null | undefined): string | null;
export function localizeServerMessage(message: string | null | undefined): string | null {
  if (!message || !useChinese) return message ?? null;
  return translateProviderStatusMessage(message) ?? message;
}
