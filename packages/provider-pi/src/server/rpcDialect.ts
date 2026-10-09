/**
 * Normalize OMP's JSONL protocol to the Pi subset consumed by T3.
 * Verified against omp/18.7.0's embedded docs/rpc.md and RPC implementation.
 * Remain on protocol v1 (no rpc_chunk negotiation); Pi is a strict passthrough.
 */
import type { PiRpcRecord } from "./rpc.ts";
export function isOmpBinary(command: string): boolean {
  return /(?:^|[/\\])omp(?:\.(?:exe|cmd|bat))?$/i.test(command.trim());
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
