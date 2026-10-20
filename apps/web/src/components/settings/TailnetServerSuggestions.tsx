import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { tailnetServersAtom } from "../../connection/tailnetDiscovery";
import { Button } from "../ui/button";

/** Fork patch 7: servers found on the tailnet, added without typing an address or code. */
export function TailnetServerSuggestions(props: {
  readonly disabled: boolean;
  readonly onAdd: (httpBaseUrl: string) => void;
}) {
  const servers = Option.getOrElse(AsyncResult.value(useAtomValue(tailnetServersAtom)), () => []);
  if (servers.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground">On your tailnet</p>
      {servers.map((server) => (
        <div
          key={server.environmentId}
          className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">
              {server.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {server.nodeName} · {server.httpBaseUrl}
            </span>
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={props.disabled}
            onClick={() => props.onAdd(server.httpBaseUrl)}
          >
            Add
          </Button>
        </div>
      ))}
    </div>
  );
}
