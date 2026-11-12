import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { builtInExtension } from "@t3tools/shared/builtInExtensions";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Tool, Toolkit } from "effect/ai";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import * as MachineRelay from "../mcp/toolkits/environment/machineRelay.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import type { ServerExtension } from "./points.ts";

const MachineCallTool = Tool.make("t3_machine_call", {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
  ],
  description:
    "Call a T3 tool on another of the owner's machines (`tailnet` names in `t3_environment_read`). An offline machine answers at once with when it was last seen. That machine sees an outside client, not your thread: pass projectId or threadId. Calls end after 2 minutes. Full-access caller only.",
  parameters: MachineRelay.MachineCallParameters,
  success: MachineRelay.MachineCallResult,
}).annotate(Tool.Destructive, true);

const MachineToolkit = Toolkit.make(MachineCallTool);

// The relay is absent where the server was built without Tailscale pairing.
const handlers = McpToolAccess.toLayer(
  MachineToolkit,
  Effect.gen(function* () {
    const relay = yield* Effect.serviceOption(MachineRelay.MachineRelay);
    return {
      t3_machine_call: McpToolAccess.writesEnvironment((params) =>
        Option.isSome(relay)
          ? relay.value.call(params)
          : Effect.fail(
              new OrchestratorMcpFailure({
                code: "provider_unavailable",
                message: "This server cannot reach other machines.",
              }),
            ),
      ),
    };
  }),
);

export const ownerMachines: ServerExtension = {
  ...builtInExtension("owner-machine-calls"),
  contributes: { mcpToolkits: [(register) => register(MachineToolkit, handlers)] },
};
