import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import { Argument, Command, GlobalFlag } from "effect/cli";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as TailscalePairing from "../auth/TailscalePairing.ts";
import * as ServerConfig from "../config.ts";
import { authLocationFlags, type CliAuthLocationFlags, resolveCliAuthConfig } from "./config.ts";

const runWithBlockStore = Effect.fn("cli.authTailscale.runWithBlockStore")(function* <A, E>(
  flags: CliAuthLocationFlags,
  run: (store: Effect.Success<typeof TailscalePairing.makeBlockStore>) => Effect.Effect<A, E>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  return yield* Effect.flatMap(TailscalePairing.makeBlockStore, run).pipe(
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, "Error")),
      ),
    ),
  );
});

const describeNode = (node: TailscalePairing.BlockedTailscaleNode) =>
  `${node.kind === "mcp" ? "MCP agent" : "device"}  ${node.label ?? "(unnamed)"}  ${node.stableNodeId}  revoked ${DateTime.formatIso(node.revokedAt)}`;

const blockedCommand = Command.make("blocked", authLocationFlags).pipe(
  Command.withDescription(
    "List tailnet devices and MCP agents whose Tailscale sign-in was revoked, so a person must approve them again.",
  ),
  Command.withHandler((flags) =>
    runWithBlockStore(flags, (store) =>
      Effect.gen(function* () {
        const blocked = yield* store.listBlocked;
        yield* Console.log(
          blocked.length === 0
            ? "No tailnet device is blocked from Tailscale pairing.\n"
            : `${blocked.map(describeNode).join("\n")}\n`,
        );
      }),
    ),
  ),
);

const unblockCommand = Command.make("unblock", {
  ...authLocationFlags,
  device: Argument.String("device").pipe(
    Argument.withDescription("Device name or Tailscale node ID, as `blocked` lists them."),
  ),
}).pipe(
  Command.withDescription(
    "Let a revoked tailnet device or MCP agent sign in over Tailscale again.",
  ),
  Command.withHandler((flags) =>
    runWithBlockStore(flags, (store) =>
      Effect.gen(function* () {
        const wanted = flags.device.trim().toLowerCase();
        const blocked = yield* store.listBlocked;
        const matches = blocked.filter(
          (node) =>
            node.stableNodeId.toLowerCase() === wanted || node.label?.toLowerCase() === wanted,
        );
        if (matches.length === 0) {
          yield* Console.log(
            `No blocked tailnet device matches ${flags.device}. Run \`t3 auth tailscale blocked\` to list them.\n`,
          );
          return;
        }
        yield* Effect.forEach(matches, store.unblock, { discard: true });
        yield* Console.log(
          `${matches.map((node) => `Unblocked ${node.label ?? node.stableNodeId}.`).join("\n")}\n`,
        );
      }),
    ),
  ),
);

/** Fork patch 7: undoes the block a revoked Tailscale sign-in leaves on its device. */
export const tailscaleCommand = Command.make("tailscale").pipe(
  Command.withDescription("Manage Tailscale pairing for tailnet devices."),
  Command.withSubcommands([blockedCommand, unblockCommand]),
);
