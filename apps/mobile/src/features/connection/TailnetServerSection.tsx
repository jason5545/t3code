import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import { tailnetServersAtom } from "../../connection/tailnetDiscovery";
import {
  useRemoteConnectionStatus,
  useRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { buildPairingUrl } from "./pairing";

/**
 * Fork patch 7: servers that connected environments see on the tailnet,
 * added by address alone so they pair over Tailscale. Shown on the add screen
 * and under the environment lists, so a new machine shows up without a search.
 */
export function TailnetServerSection(props: {
  readonly placement: "add-screen" | "environment-list";
  readonly disabled: boolean;
  readonly onConnect: (httpBaseUrl: string) => void;
}) {
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const discovered = AsyncResult.value(useAtomValue(tailnetServersAtom));
  // The answer is reused for a while, so leave out what was added since.
  const added = new Set(connectedEnvironments.map((environment) => environment.environmentId));
  const servers = Option.getOrElse(discovered, () => []).filter(
    (server) => !added.has(server.environmentId),
  );
  // With no environment there is no one to ask; the address field takes a machine name.
  if (connectedEnvironments.length === 0) return null;
  if (
    servers.length === 0 &&
    (props.placement === "environment-list" || Option.isNone(discovered))
  ) {
    return null;
  }

  return (
    <View collapsable={false} className={props.placement === "add-screen" ? "gap-2" : "mt-5 gap-2"}>
      {props.placement === "add-screen" ? (
        <Text className="px-4 text-sm font-t3-medium text-foreground-muted">On your tailnet</Text>
      ) : (
        <Text className="px-4 text-sm font-t3-medium text-foreground-muted">
          Add from your tailnet
        </Text>
      )}
      {servers.length === 0 ? (
        <Text className="px-4 text-sm leading-normal text-foreground-muted">
          Every server on your tailnet is added.
        </Text>
      ) : (
        <View collapsable={false} className="overflow-hidden rounded-[26px] border-continuous">
          {servers.map((server) => (
            <ListRow
              key={server.environmentId}
              label={server.label}
              description={`${server.nodeName} · ${server.httpBaseUrl}`}
              disabled={props.disabled}
              onPress={() => props.onConnect(server.httpBaseUrl)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/** Under an environment list: one tap pairs the server over Tailscale and adds it there. */
export function TailnetServerSuggestions() {
  const { onConnectPress } = useRemoteConnections();
  const [adding, setAdding] = useState(false);

  const add = async (httpBaseUrl: string) => {
    setAdding(true);
    const outcome = await onConnectPress(buildPairingUrl(httpBaseUrl, ""));
    setAdding(false);
    // A null error already got its own dialog (an unsupported client).
    if (outcome.error !== null) Dialog.alert("Could not add the server", outcome.error);
  };

  return (
    <TailnetServerSection
      placement="environment-list"
      disabled={adding}
      onConnect={(httpBaseUrl) => void add(httpBaseUrl)}
    />
  );
}
