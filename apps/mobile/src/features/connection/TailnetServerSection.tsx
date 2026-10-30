import { useAtomValue } from "@effect/atom-react";
import type { TailnetDiscovery } from "@t3tools/client-runtime/connection";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { tailnetDiscoveryAtom } from "../../connection/tailnetDiscovery";
import {
  tailnetEntryCandidatesAtom,
  tailnetEntryUrls,
  type TailnetEntryCandidate,
} from "../../connection/tailnetEntry";
import {
  useRemoteConnectionStatus,
  useRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { buildPairingUrl } from "./pairing";

type DiscoveredTailnetServer = TailnetDiscovery.DiscoveredTailnetServer;

/** What the background discovery last found, without servers added since it answered. */
function useTailnetDiscovery(): TailnetDiscovery.TailnetDiscoveryView {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const view = Option.getOrElse(
    AsyncResult.value(useAtomValue(tailnetDiscoveryAtom)),
    (): TailnetDiscovery.TailnetDiscoveryView => ({ kind: "unavailable" }),
  );
  if (view.kind !== "found") return view;
  const added = new Set(connectedEnvironments.map((environment) => environment.environmentId));
  const servers = view.servers.filter((server) => !added.has(server.environmentId));
  return servers.length === 0 ? { kind: "none-found" } : { kind: "found", servers };
}

/** One tap pairs the server over Tailscale, only if it still answers as the suggested environment. */
function useAddTailnetServer() {
  const { onConnectPress } = useRemoteConnections();
  const [adding, setAdding] = useState(false);
  const add = async (server: DiscoveredTailnetServer) => {
    setAdding(true);
    const outcome = await onConnectPress(
      buildPairingUrl(server.httpBaseUrl, ""),
      undefined,
      server.environmentId,
    );
    setAdding(false);
    // A null error already got its own dialog (an unsupported client).
    if (outcome.error !== null) Dialog.alert("Could not add the server", outcome.error);
  };
  return { adding, add };
}

/**
 * Fork patch 7: servers that connected environments see on the tailnet,
 * added by address alone so they pair over Tailscale. Shown on the add screen
 * and under the environment lists, so a new machine shows up without a search.
 */
export function TailnetServerSection(props: {
  readonly placement: "add-screen" | "environment-list";
  readonly disabled: boolean;
  readonly onConnect: (server: DiscoveredTailnetServer) => void;
}) {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const view = useTailnetDiscovery();
  // With no environment there is no one to ask; the address field takes a machine name.
  if (connectedEnvironments.length === 0) return null;
  if (view.kind !== "found" && props.placement === "environment-list") return null;

  return (
    <View collapsable={false} className={props.placement === "add-screen" ? "gap-2" : "mt-5 gap-2"}>
      {props.placement === "add-screen" ? (
        <Text className="px-4 text-sm font-t3-medium text-foreground-muted">On your tailnet</Text>
      ) : (
        <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
          Add from your tailnet
        </Text>
      )}
      {view.kind === "found" ? (
        <View collapsable={false} className="overflow-hidden rounded-[26px] border-continuous">
          {view.servers.map((server) => (
            <ListRow
              key={server.environmentId}
              label={server.label}
              description={`${server.nodeName} · ${server.httpBaseUrl}`}
              disabled={props.disabled}
              onPress={() => props.onConnect(server)}
            />
          ))}
        </View>
      ) : view.kind === "none-found" ? (
        <Text className="px-4 text-sm leading-normal text-foreground-muted">
          No servers to add were found right now.
        </Text>
      ) : (
        <Text className="px-4 text-sm leading-normal text-foreground-muted">
          Can't get the server list right now.
        </Text>
      )}
    </View>
  );
}

/** Under an environment list: one tap pairs the server over Tailscale and adds it there. */
export function TailnetServerSuggestions() {
  const { adding, add } = useAddTailnetServer();
  return (
    <TailnetServerSection
      placement="environment-list"
      disabled={adding}
      onConnect={(server) => void add(server)}
    />
  );
}

/** On Home, so a new machine on the tailnet shows up without opening Settings. */
export function TailnetServerHomeRows() {
  const view = useTailnetDiscovery();
  const { adding, add } = useAddTailnetServer();
  if (view.kind !== "found") return null;
  return (
    <View
      collapsable={false}
      className="mx-4 mb-3 overflow-hidden rounded-[26px] border-continuous"
    >
      {view.servers.map((server) => (
        <ListRow
          key={server.environmentId}
          icon="plus"
          label={tailnetSuggestionLabel(server.label)}
          description="Tap to add"
          disabled={adding}
          onPress={() => void add(server)}
        />
      ))}
    </View>
  );
}

const tailnetSuggestionLabel = (name: string) => `Found ${name} on your tailnet`;

/**
 * With no environment, the build's entry servers that answer. Mounted only then, so the
 * probing stops once a server is added.
 */
export function TailnetEntrySection(props: {
  readonly disabled: boolean;
  readonly onConnect: (candidate: TailnetEntryCandidate) => void;
}) {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  if (connectedEnvironments.length > 0 || tailnetEntryUrls.length === 0) return null;
  return <TailnetEntryRows {...props} />;
}

function TailnetEntryRows(props: {
  readonly disabled: boolean;
  readonly onConnect: (candidate: TailnetEntryCandidate) => void;
}) {
  const candidates = Option.getOrElse(
    AsyncResult.value(useAtomValue(tailnetEntryCandidatesAtom)),
    (): ReadonlyArray<TailnetEntryCandidate> => [],
  );
  if (candidates.length === 0) return null;
  return (
    <View collapsable={false} className="gap-2">
      <Text className="px-4 text-sm font-t3-medium text-foreground-muted">Possible T3 servers</Text>
      <View collapsable={false} className="overflow-hidden rounded-[26px] border-continuous">
        {candidates.map((candidate) => (
          <ListRow
            key={candidate.httpBaseUrl}
            label={candidate.label}
            description={new URL(candidate.httpBaseUrl).host}
            disabled={props.disabled}
            onPress={() => props.onConnect(candidate)}
          />
        ))}
      </View>
    </View>
  );
}
