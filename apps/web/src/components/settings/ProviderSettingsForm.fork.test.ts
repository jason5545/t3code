import { IDLE_COMPACTION_MODES } from "@t3tools/contracts";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import { translateProviderStatusMessage } from "@t3tools/client-runtime/providerStatusMessages";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderSettingsFields, type SettingsFormDefinition } from "./ProviderSettingsForm";

// Product names shown as select options.
const KEPT_ENGLISH = new Set(["Gemini Enterprise", "Agent Platform (Vertex AI)", "ACP Registry"]);

function settingsFormText(): ReadonlyArray<string> {
  const definitions: ReadonlyArray<SettingsFormDefinition> = [
    ...providerClients.definitions,
    ...sourceControlClients.definitions.flatMap((definition) =>
      definition.settings === undefined ? [] : [{ settingsSchema: definition.settings }],
    ),
  ];
  const text = new Set<string>(IDLE_COMPACTION_MODES.map((mode) => mode.label));
  for (const definition of definitions) {
    for (const value of [undefined, { source: "local" }]) {
      for (const field of deriveProviderSettingsFields(definition, value)) {
        text.add(field.label);
        if (field.description) text.add(field.description);
        // Paths, commands and sample values are lowercase; words and examples are not.
        if (field.placeholder && /^(?:[A-Z]|e\.g\. )/.test(field.placeholder)) {
          text.add(field.placeholder);
        }
        for (const option of field.options ?? []) text.add(option.label);
      }
    }
  }
  return [...text];
}

describe("provider settings form text", () => {
  it("has Chinese for every schema title, description and option", () => {
    const missing = settingsFormText().filter(
      (text) => !KEPT_ENGLISH.has(text) && translateProviderStatusMessage(text) === null,
    );
    expect(missing).toEqual([]);
  });
});
