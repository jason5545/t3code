import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type {
  ExtensionEntry,
  ExtensionMarketplaceEntry,
  ExtensionsRequest,
  ExtensionsSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { requestExtensions } from "../../extensions/commands";
import { applyExtensionsSnapshot } from "../../extensions/runtime";
import { localizeServerMessage } from "../../locale/serverMessages";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const UNREACHABLE = "The server could not be reached.";

const answered = (result: AtomCommandResult<Option.Option<ExtensionsSnapshot>, unknown>) =>
  result._tag === "Success" ? Option.getOrNull(result.value) : null;

type Marketplace =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly reason: string }
  | {
      readonly state: "ready";
      readonly url: string;
      readonly offered: ReadonlyArray<ExtensionMarketplaceEntry>;
    };

const marketplaceOf = (snapshot: ExtensionsSnapshot | null): Marketplace =>
  snapshot === null
    ? { state: "failed", reason: UNREACHABLE }
    : snapshot.marketplace === null
      ? { state: "failed", reason: snapshot.error ?? UNREACHABLE }
      : { state: "ready", url: snapshot.marketplaceUrl, offered: snapshot.marketplace };

/**
 * Fork patch 30: Settings → Extensions, the extensions of the server this app is served from.
 * Built-in ones can be turned off; ones from the marketplace can also be removed.
 */
export function ExtensionsSettingsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  const request = useAtomCommand(requestExtensions, { reportFailure: false });
  const [extensions, setExtensions] = useState<ReadonlyArray<ExtensionEntry> | null>(null);
  const [marketplace, setMarketplace] = useState<Marketplace>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const change = async (action: ExtensionsRequest) => {
    if (environmentId === null) return;
    setBusy(true);
    const next = answered(await request({ environmentId, request: action }));
    setBusy(false);
    setProblem(next === null ? UNREACHABLE : next.error);
    if (next === null) return;
    setExtensions(next.extensions);
    applyExtensionsSnapshot(next);
  };

  const checkMarketplace = async () => {
    if (environmentId === null) return;
    setMarketplace({ state: "loading" });
    const next = await request({ environmentId, request: { action: "read", marketplace: true } });
    setMarketplace(marketplaceOf(answered(next)));
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the list from the server when the page opens
  useEffect(() => {
    if (environmentId === null) return;
    let stale = false;
    // The list first: the marketplace is another server and may be slow or out of reach.
    void request({ environmentId, request: { action: "read" } }).then((result) => {
      if (stale) return;
      const next = answered(result);
      setProblem(next === null ? UNREACHABLE : next.error);
      if (next !== null) setExtensions(next.extensions);
    });
    void request({ environmentId, request: { action: "read", marketplace: true } }).then(
      (result) => {
        if (!stale) setMarketplace(marketplaceOf(answered(result)));
      },
    );
    return () => {
      stale = true;
    };
  }, [environmentId, request]);

  const installed = new Map(
    (extensions ?? []).flatMap(({ id, builtIn, version }) =>
      builtIn ? [] : [[id, version] as const],
    ),
  );
  const offered =
    marketplace.state === "ready"
      ? marketplace.offered.filter(({ id, version }) => installed.get(id) !== version)
      : [];
  const checkAgain = (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkMarketplace()}>
      Check again
    </Button>
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="extensions" title="Installed">
        {problem === null ? null : (
          <p role="alert" className="px-1 pb-2 text-xs text-destructive">
            {localizeServerMessage(problem)}
          </p>
        )}
        {extensions === null && problem === null ? <SettingsRow title="Loading…" /> : null}
        {(extensions ?? []).map((extension) => (
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
                    onClick={() => void change({ action: "remove", id: extension.id })}
                  >
                    Remove
                  </Button>
                )}
                <Switch
                  checked={extension.enabled}
                  disabled={busy || extension.required}
                  aria-label={localizeServerMessage(extension.title)}
                  onCheckedChange={(enabled) =>
                    void change({ action: "setEnabled", id: extension.id, enabled })
                  }
                />
              </div>
            }
          />
        ))}
      </SettingsSection>
      <SettingsSection id="extension-marketplace" title="Marketplace">
        {marketplace.state === "loading" ? <SettingsRow title="Checking the marketplace…" /> : null}
        {marketplace.state === "failed" ? (
          <SettingsRow
            title="The marketplace could not be read"
            description={localizeServerMessage(marketplace.reason)}
            control={checkAgain}
          />
        ) : null}
        {marketplace.state === "ready" && offered.length === 0 ? (
          <SettingsRow
            title="Nothing new to install"
            description={marketplace.url}
            control={checkAgain}
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
                onClick={() => void change({ action: "install", id: extension.id })}
              >
                {installed.has(extension.id) ? "Update" : "Install"}
              </Button>
            }
          />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
