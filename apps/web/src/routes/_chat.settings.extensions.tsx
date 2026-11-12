import { createFileRoute } from "@tanstack/react-router";
import { ExtensionsSettingsPanel } from "../components/settings/ExtensionsSettings";

// Fork patch 30.
export const Route = createFileRoute("/_chat/settings/extensions")({
  component: ExtensionsSettingsPanel,
});
