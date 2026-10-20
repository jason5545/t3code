import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ListRow } from "../../components/ui/ListRow";
import {
  removeTailscaleApiCredentials,
  saveTailscaleApiCredentials,
  tailnetServersAtom,
  tailscaleApiConfiguredAtom,
} from "../../connection/tailnetDiscovery";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * Fork patch 7: servers found on the tailnet, added by address alone so they
 * pair over Tailscale. Without an environment to ask, the Tailscale API finds
 * them instead.
 */
export function TailnetServerSection(props: {
  readonly disabled: boolean;
  readonly onConnect: (httpBaseUrl: string) => void;
}) {
  const servers = Option.getOrElse(AsyncResult.value(useAtomValue(tailnetServersAtom)), () => []);
  const apiConfigured = Option.getOrElse(
    AsyncResult.value(useAtomValue(tailscaleApiConfiguredAtom)),
    () => false,
  );
  const saveCredentials = useAtomCommand(saveTailscaleApiCredentials, { reportFailure: false });
  const removeCredentials = useAtomCommand(removeTailscaleApiCredentials, {
    reportFailure: false,
  });

  const askForCredentials = () =>
    Dialog.prompt({
      title: "Tailscale OAuth client ID",
      message:
        "Create an OAuth client with the devices:core:read scope in the Tailscale admin console.",
      initialValue: "",
      confirmText: "Next",
      onConfirm: (clientId) =>
        Dialog.prompt({
          title: "Tailscale OAuth client secret",
          initialValue: "",
          confirmText: "Save",
          onConfirm: (clientSecret) => {
            void saveCredentials({
              clientId: clientId.trim(),
              clientSecret: clientSecret.trim(),
            }).then((result) => {
              if (AsyncResult.isFailure(result)) {
                Dialog.alert(
                  "Could not use the Tailscale API",
                  "Check the OAuth client ID and secret, and that the client has the devices:core:read scope.",
                );
              }
            });
          },
        }),
    });

  const confirmRemove = () =>
    Dialog.confirm({
      title: "Stop using the Tailscale API?",
      message: "This phone forgets the OAuth client. Servers you added stay.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => void removeCredentials(),
    });

  return (
    <View collapsable={false} className="gap-2">
      <Text className="px-4 text-sm font-t3-medium text-foreground-muted">On your tailnet</Text>
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
        <ListRow
          label={apiConfigured ? "Tailscale API is on" : "Find servers with the Tailscale API"}
          description={
            apiConfigured
              ? "Tap to remove its OAuth client from this phone."
              : "For a phone with no environment to ask yet."
          }
          onPress={apiConfigured ? confirmRemove : askForCredentials}
        />
      </View>
    </View>
  );
}
