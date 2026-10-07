import { describe, expect, it } from "vite-plus/test";
import { isOmpBinary, makePiRpcDialect } from "./piRpcDialect.ts";
describe("Pi RPC dialect", () => {
  it.each(["omp", "/opt/homebrew/bin/omp", "C:\\bin\\omp.cmd", "OMP.exe"])(
    "detects %s",
    (command) => {
      expect(isOmpBinary(command)).toBe(true);
    },
  );
  it.each(["pi", "my-omp", "/omp/pi", "omp-extra", "omp --help"])(
    "does not misidentify %s",
    (command) => {
      expect(isOmpBinary(command)).toBe(false);
    },
  );
  it("leaves Pi args, requests and events untouched", () => {
    const pi = makePiRpcDialect("pi");
    const args = ["--mode", "rpc", "--fork", "/source.jsonl"];
    expect(pi.launchArgs(args)).toBe(args);
    for (const record of [
      { type: "prompt", message: "/command" },
      { type: "get_commands", id: "t3-1" },
      { type: "fork", entryId: "discarded-user" },
      { type: "response", command: "prompt", success: true },
      { type: "agent_settled" },
    ]) {
      expect(pi.outgoing(record)).toBe(record);
      expect(pi.incoming(record)).toEqual([record]);
    }
  });
  it("enables tool UI without opening the fork source for writing", () => {
    const omp = makePiRpcDialect("omp");
    expect(omp.launchArgs(["--mode", "rpc", "--fork", "/source.jsonl"])).toEqual([
      "--mode",
      "rpc-ui",
      "--fork",
      "/source.jsonl",
    ]);
    expect(omp.launchArgs(["--mode=rpc", "--extension", "rpc"])).toEqual([
      "--mode=rpc-ui",
      "--extension",
      "rpc",
    ]);
  });
  it("uses the installed OMP command catalog, not list_commands or Pi get_commands", () => {
    const omp = makePiRpcDialect("omp");
    expect(omp.outgoing({ type: "get_commands", id: "t3-1" })).toEqual({
      type: "get_available_commands",
      id: "t3-1",
    });
    expect(
      omp.incoming({
        type: "response",
        id: "t3-1",
        command: "get_available_commands",
        success: true,
        data: { commands: [] },
      }),
    ).toEqual([
      {
        type: "response",
        id: "t3-1",
        command: "get_commands",
        success: true,
        data: { commands: [] },
      },
    ]);
  });
  it("retains prompt request ids until prompt_result rather than resolving at admission", () => {
    const omp = makePiRpcDialect("omp");
    expect(omp.outgoing({ type: "prompt", id: "t3-7", message: "hello" }).id).toBe("t3-7");
    expect(
      omp.incoming({ type: "response", id: "t3-7", command: "prompt", success: true }),
    ).toEqual([]);
    const result = {
      type: "prompt_result",
      id: "t3-7",
      agentInvoked: true,
      status: "completed",
      sessionSettled: false,
    };
    expect(omp.incoming(result)).toEqual([
      { type: "response", command: "prompt", id: "t3-7", success: true, data: result },
    ]);
    expect(omp.incoming({ type: "session_settled" })).toEqual([{ type: "agent_settled" }]);
  });
  it("waits for an extension command's local completion but supports builtin local acknowledgements", () => {
    const omp = makePiRpcDialect("omp");
    const sent = omp.outgoing({ type: "prompt", message: "/custom" });
    expect(typeof sent.id).toBe("string");
    expect(
      omp.incoming({ type: "response", id: sent.id, command: "prompt", success: true }),
    ).toEqual([]);
    const result = {
      type: "prompt_result",
      id: sent.id,
      agentInvoked: false,
      status: "completed",
      sessionSettled: true,
    };
    const normalized = omp.incoming(result);
    expect(normalized[0]).toMatchObject({ type: "response", command: "prompt", success: true });
    expect(normalized[0]).not.toHaveProperty("id");
    expect(normalized[1]).toEqual({ type: "agent_settled" });
    const builtin = omp.outgoing({ type: "prompt", message: "/version", id: "t3-8" });
    expect(
      omp.incoming({
        type: "response",
        command: "prompt",
        id: builtin.id,
        success: true,
        data: { agentInvoked: false },
      })[0],
    ).toMatchObject({ id: "t3-8", success: true });
  });
  it("correlates interleaved fire-and-forget and requested prompts independently", () => {
    const omp = makePiRpcDialect("omp");
    const sent = omp.outgoing({ type: "prompt", message: "initial" });
    omp.outgoing({ type: "prompt", id: "t3-1", message: "queued", streamingBehavior: "steer" });
    expect(
      omp.incoming({
        type: "prompt_result",
        id: "t3-1",
        status: "completed",
        sessionSettled: false,
      })[0]?.id,
    ).toBe("t3-1");
    expect(
      omp.incoming({
        type: "prompt_result",
        id: sent.id,
        status: "completed",
        sessionSettled: false,
      })[0],
    ).not.toHaveProperty("id");
  });
  it("surfaces admission and local failures with the original id", () => {
    const omp = makePiRpcDialect("omp");
    omp.outgoing({ type: "prompt", id: "t3-1", message: "bad" });
    expect(
      omp.incoming({
        type: "response",
        command: "prompt",
        id: "t3-1",
        success: false,
        error: "bad input",
      })[0],
    ).toMatchObject({ id: "t3-1", success: false, error: "bad input" });
    omp.outgoing({ type: "prompt", id: "t3-2", message: "/bad" });
    expect(
      omp.incoming({
        type: "prompt_result",
        id: "t3-2",
        status: "error",
        error: { message: "extension failed" },
        sessionSettled: true,
      })[0],
    ).toMatchObject({ id: "t3-2", success: false, error: "extension failed" });
  });
  it("maps the queue count while retaining OMP's stronger idle predicate", () => {
    const omp = makePiRpcDialect("omp");
    expect(
      omp.incoming({
        type: "response",
        command: "get_state",
        data: { queuedMessageCount: 2, isSettled: false, hasPendingAsyncWork: true },
      })[0]?.data,
    ).toEqual({
      queuedMessageCount: 2,
      pendingMessageCount: 2,
      isSettled: false,
      hasPendingAsyncWork: true,
    });
  });
  it("cuts before discarded user entries rather than retaining the next turn's input", () => {
    const omp = makePiRpcDialect("omp");
    expect(omp.outgoing({ type: "fork", id: "t3-1", entryId: "next-user" })).toEqual({
      type: "branch",
      id: "t3-1",
      entryId: "next-user",
    });
    expect(omp.outgoing({ type: "fork", id: "t3-2" })).toEqual({ type: "fork", id: "t3-2" });
  });
});
