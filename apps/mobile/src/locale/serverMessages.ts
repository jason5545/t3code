import {
  translateProviderOptionLabel,
  translateProviderStatusMessage,
} from "@t3tools/client-runtime/providerStatusMessages";

import { useChinese } from "./autoTranslateRuntime";

/** Shows a server-written provider status message in the interface language. */
export function localizeServerMessage(message: string): string;
export function localizeServerMessage(message: string | null | undefined): string | null;
export function localizeServerMessage(message: string | null | undefined): string | null {
  if (!message || !useChinese) return message ?? null;
  return translateProviderStatusMessage(message) ?? message;
}

/** Shows a server-written model option label (reasoning effort, speed) in the interface language. */
export function localizeProviderOptionLabel(label: string): string;
export function localizeProviderOptionLabel(label: string | null | undefined): string | null;
export function localizeProviderOptionLabel(label: string | null | undefined): string | null {
  if (!label || !useChinese) return label ?? null;
  return translateProviderOptionLabel(label) ?? label;
}
