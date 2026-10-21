/**
 * Normalize OMP's JSONL protocol to the Pi subset consumed by T3.
 * Verified against omp/18.7.0's embedded docs/rpc.md and RPC implementation.
 * Remain on protocol v1 (no rpc_chunk negotiation); Pi is a strict passthrough.
 */
import { OMP_ICON_URL, providerIconKind } from "@t3tools/contracts";

import type { PiRpcRecord } from "./rpc.ts";
export function isOmpBinary(command: string): boolean {
  return /(?:^|[/\\])omp(?:\.(?:exe|cmd|bat))?$/i.test(command.trim());
}

/** An OMP instance's snapshot carries OMP's mark, for clients handed only a driver and icon. */
export function ompInstanceIcon(displayName: string | undefined): { readonly iconUrl?: string } {
  return providerIconKind("pi", displayName) === "omp" ? { iconUrl: OMP_ICON_URL } : {};
}

export interface OmpTodoStep {
  readonly text: string;
  readonly status: "pending" | "running" | "completed";
}

/**
 * Flatten the phases a successful OMP `todo` call reports in `details`.
 * `view` only reads the list, and other shapes are not OMP's todo tool, so
 * both return undefined. Abandoned tasks are closed; blocked ones still wait.
 * Phase names prefix their tasks only when there is more than one phase.
 */
export function ompTodoSteps(details: unknown): ReadonlyArray<OmpTodoStep> | undefined {
  const record = object(details);
  if (record === undefined || record.op === "view" || !Array.isArray(record.phases)) {
    return undefined;
  }
  const phases = record.phases.map(object);
  if (phases.some((phase) => phase === undefined || !Array.isArray(phase.tasks))) return undefined;
  const named = phases.length > 1;
  return phases.flatMap((phase) =>
    (phase!.tasks as ReadonlyArray<unknown>).flatMap((value) => {
      const task = object(value);
      const content = typeof task?.content === "string" ? task.content.trim() : "";
      if (content === "") return [];
      const name = typeof phase!.name === "string" ? phase!.name.trim() : "";
      return [
        {
          text: named && name !== "" ? `${name}: ${content}` : content,
          status:
            task!.status === "completed" || task!.status === "abandoned"
              ? "completed"
              : task!.status === "in_progress"
                ? "running"
                : "pending",
        } as const,
      ];
    }),
  );
}

export interface PiRpcDialect {
  readonly launchArgs: (args: ReadonlyArray<string>) => ReadonlyArray<string>;
  readonly outgoing: (record: PiRpcRecord) => PiRpcRecord;
  readonly incoming: (record: PiRpcRecord) => ReadonlyArray<PiRpcRecord>;
}

function object(value: unknown): PiRpcRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PiRpcRecord)
    : undefined;
}

export function makePiRpcDialect(command: string): PiRpcDialect {
  if (!isOmpBinary(command)) {
    return {
      launchArgs: (args) => args,
      outgoing: (record) => record,
      incoming: (record) => [record],
    };
  }

  // T3's adapter sends prompts without ids, whereas request() supplies one.
  // Assign wire-only ids to the former so interleaved admissions/results cannot
  // lose correlation. Never strip the caller's id from a correlated result.
  const prompts = new Map<string, { readonly id: unknown; readonly command: string }>();
  let nextPromptId = 0;
  const response = (
    record: PiRpcRecord,
    prompt: { readonly id: unknown; readonly command: string },
  ) => {
    const normalized: PiRpcRecord = { ...record, command: prompt.command };
    if (prompt.id === undefined) delete normalized.id;
    else normalized.id = prompt.id;
    return normalized;
  };
  return {
    launchArgs: (args) =>
      args.map((arg, index) =>
        arg === "rpc" && args[index - 1] === "--mode"
          ? "rpc-ui"
          : arg === "--mode=rpc"
            ? "--mode=rpc-ui"
            : arg,
      ),
    outgoing: (record) => {
      switch (record.type) {
        case "get_commands":
          return { ...record, type: "get_available_commands" };
        case "fork":
          // Pi cuts BEFORE the first discarded user entry. OMP fork(entryId)
          // includes it; OMP branch(entryId) has Pi's before-user semantics and
          // also creates a new session file. Whole-session fork stays fork.
          return record.entryId === undefined ? record : { ...record, type: "branch" };
        case "prompt":
        case "abort_and_prompt": {
          const id = typeof record.id === "string" ? record.id : `t3-omp-prompt-${nextPromptId++}`;
          prompts.set(id, { id: record.id, command: String(record.type) });
          return { ...record, id };
        }
        default:
          return record;
      }
    },
    incoming: (record) => {
      if (record.type === "session_settled") return [{ ...record, type: "agent_settled" }];
      // Pi lifts the streaming message's cumulative usage to the event; OMP
      // only carries it on the partial message, which the live meter reads.
      if (record.type === "message_update" && record.usage === undefined) {
        const usage = object(object(record.message)?.usage);
        if (usage !== undefined) return [{ ...record, usage }];
      }
      if (record.type === "response") {
        if (record.command === "get_available_commands") {
          return [{ ...record, command: "get_commands" }];
        }
        if (record.command === "get_state") {
          const data = object(record.data);
          if (data !== undefined) {
            return [
              {
                ...record,
                data: {
                  ...data,
                  pendingMessageCount: data.queuedMessageCount ?? 0,
                },
              },
            ];
          }
        }
        const prompt = typeof record.id === "string" ? prompts.get(record.id) : undefined;
        if (prompt !== undefined) {
          // A success ack means admission, not completion. Extensions can ack
          // before executing any work, so even slash commands must wait for the
          // result. Only agentInvoked:false in the ack completes locally.
          if (record.success === true && object(record.data)?.agentInvoked !== false) return [];
          prompts.delete(String(record.id));
          return [response(record, prompt)];
        }
      }
      if (record.type === "prompt_result") {
        const prompt = typeof record.id === "string" ? prompts.get(record.id) : undefined;
        if (prompt === undefined) return [record];
        prompts.delete(String(record.id));
        const result = response(
          {
            type: "response",
            id: record.id,
            success: record.status !== "error",
            data: record,
            ...(record.status === "error"
              ? { error: object(record.error)?.message ?? record.error }
              : {}),
          },
          prompt,
        );
        // A yield with pending background work must NOT terminalize the turn.
        // session_settled will arrive after all continuations have finished.
        return record.sessionSettled === true ? [result, { type: "agent_settled" }] : [result];
      }
      return [record];
    },
  };
}
