import type { ExtensionInfo } from "./extensions.ts";

/**
 * The extensions this build carries (patches.md "Extension system"). They can be turned off
 * but not removed; one marked `required` cannot be turned off, because the rest of its
 * feature depends on it.
 */
export interface BuiltInExtension extends ExtensionInfo {
  readonly description: string;
  readonly required?: true;
}

const BUILT_IN = {
  "owner-machine-calls": {
    title: "Calls to your other machines",
    description:
      "The t3_machine_call tool, which lets agents use T3 tools on your other machines. Changes apply after the server restarts.",
    patch: 22,
  },
  "language-selector": {
    title: "Interface language selector",
    description: "The language section in Settings → General and Appearance.",
    patch: 2,
  },
  "tailnet-suggestions": {
    title: "Tailnet server suggestions",
    description:
      "Servers found on your tailnet, offered when you add an environment. The mobile app keeps showing them.",
    patch: 7,
  },
  "summarized-update-badge": {
    title: "Summary badge",
    description: "Marks a Claude update that is the provider's summary, not the agent's words.",
    patch: 16,
  },
  "ephemeral-thread-watcher": {
    title: "Ephemeral thread watcher",
    description: "Keeps ephemeral threads out of this device's storage and window title.",
    patch: 11,
    required: true,
  },
  "extension-manager": {
    title: "Extension manager",
    description: "This list, and loading the extensions you install.",
    patch: 30,
    required: true,
  },
} as const satisfies Record<string, Omit<BuiltInExtension, "id">>;

export type BuiltInExtensionId = keyof typeof BUILT_IN;

export const builtInExtension = (id: BuiltInExtensionId): BuiltInExtension => ({
  id,
  ...BUILT_IN[id],
});

export const BUILT_IN_EXTENSIONS: ReadonlyArray<BuiltInExtension> = Object.keys(BUILT_IN).map(
  (id) => builtInExtension(id as BuiltInExtensionId),
);
