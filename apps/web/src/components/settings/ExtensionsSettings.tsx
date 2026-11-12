import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { ExtensionsRequest, ExtensionsSnapshot } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { requestExtensions } from "../../extensions/commands";
import { applyExtensionsSnapshot } from "../../extensions/runtime";
import { localizeServerMessage } from "../../locale/serverMessages";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const UNREACHABLE = "The server could not be reached.";

const answered = (result: AtomCommandResult<Option.Option<ExtensionsSnapshot>, unknown>) =>
  result._tag === "Success" ? Option.getOrNull(result.value) : null;

/**
 * Fork patch 30: the extensions of the server this app is served from. Built-in ones can be
 * turned off; ones from the marketplace can also be removed.
 */
export function ExtensionsSettings() {
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(requestExtensions, { reportFailure: false });
  const [snapshot, setSnapshot] = useState<ExtensionsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: ExtensionsRequest) => {
    if (environmentId === null) return;
    setBusy(true);
    const next = answered(await request({ environmentId, request: action }));
    setBusy(false);
    setFailure(next === null ? UNREACHABLE : null);
    if (next === null) return;
    setSnapshot(next);
    if (action.action !== "read") applyExtensionsSnapshot(next);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the list from the server when the page opens
  useEffect(() => {
    if (environmentId === null) return;
    let stale = false;
    void request({ environmentId, request: { action: "read", marketplace: true } }).then(
      (result) => {
        if (stale) return;
        const next = answered(result);
        setFailure(next === null ? UNREACHABLE : null);
        if (next !== null) setSnapshot(next);
      },
    );
    return () => {
      stale = true;
    };
  }, [environmentId, request]);

  const extensions = snapshot?.extensions ?? [];
  const installed = new Map(
    extensions.flatMap(({ id, builtIn, version }) => (builtIn ? [] : [[id, version] as const])),
  );
  const offered = (snapshot?.marketplace ?? []).filter(
    ({ id, version }) => installed.get(id) !== version,
  );
  const problem = failure ?? snapshot?.error ?? null;

  return (
    <>
      <SettingsSection id="extensions" title="Extensions">
        {problem === null ? null : (
          <p role="alert" className="px-1 pb-2 text-xs text-destructive">
            {localizeServerMessage(problem)}
          </p>
        )}
        {extensions.map((extension) => (
          <SettingsRow
            key={extension.id}
            title={
              extension.version === null
                ? localizeServerMessage(extension.title)
                : `${extension.title} ${extension.version}`
            }
            description={localizeServerMessage(extension.description)}
            control={
              <div className="flex items-center gap-2">
                {extension.builtIn ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run({ action: "remove", id: extension.id })}
                  >
                    Remove
                  </Button>
                )}
                <Switch
                  checked={extension.enabled}
                  disabled={busy || extension.required}
                  aria-label={localizeServerMessage(extension.title)}
                  onCheckedChange={(enabled) =>
                    void run({ action: "setEnabled", id: extension.id, enabled })
                  }
                />
              </div>
            }
          />
        ))}
      </SettingsSection>
      <SettingsSection id="extension-marketplace" title="Extension marketplace">
        {snapshot !== null && offered.length === 0 ? (
          <SettingsRow
            title="Nothing new to install"
            description={snapshot.marketplaceUrl}
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run({ action: "read", marketplace: true })}
              >
                Check again
              </Button>
            }
          />
        ) : null}
        {offered.map((extension) => (
          <SettingsRow
            key={extension.id}
            title={`${extension.title} ${extension.version}`}
            description={extension.description}
            control={
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run({ action: "install", id: extension.id })}
              >
                {installed.has(extension.id) ? "Update" : "Install"}
              </Button>
            }
          />
        ))}
      </SettingsSection>
    </>
  );
}
