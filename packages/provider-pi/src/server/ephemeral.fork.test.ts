import { assert, describe, it } from "@effect/vitest";

import {
  buildOmpEphemeralLaunch,
  OMP_EPHEMERAL_TOOLS,
  OMP_FOREIGN_CONFIG_SOURCES,
  ompEphemeralLaunchArgs,
  ompEphemeralOverlay,
  ompToolsBeyondAllowlist,
} from "./ephemeral.ts";
import { T3_MCP_BEARER_ENV, T3_MCP_URL_ENV } from "./mcpExtensionSource.ts";

describe("ephemeral OMP launch", () => {
  it("runs without a session file, title model or T3 MCP, under the overlay", () => {
    const overlayPath = "/cache/omp-ephemeral-session.yml";
    const launch = buildOmpEphemeralLaunch({
      launchArgs: ["--thinking", "high"],
      restrictions: ompEphemeralLaunchArgs(overlayPath),
      environment: {
        PATH: "/usr/bin",
        [T3_MCP_URL_ENV]: "http://127.0.0.1:3773/mcp",
        [T3_MCP_BEARER_ENV]: "Bearer inherited",
      },
      extensionPath: "/cache/pi-t3-mcp-extension.ts",
      runtimeMode: "approval-required",
    });

    assert.deepEqual(launch.args.slice(0, 3), ["--mode", "rpc", "--no-session"]);
    assert.include(launch.args, "--no-title");
    const config = launch.args.indexOf("--config");
    assert.isAbove(config, launch.args.indexOf("high"));
    assert.equal(launch.args[config + 1], overlayPath);
    assert.include(launch.args, "--tools=ask,edit,glob,grep,read,todo,write");
    // The approval hook still loads.
    assert.equal(
      launch.args[launch.args.indexOf("--extension") + 1],
      "/cache/pi-t3-mcp-extension.ts",
    );
    assert.isFalse(launch.hasT3Mcp);
    assert.isUndefined(launch.env[T3_MCP_URL_ENV]);
    assert.isUndefined(launch.env[T3_MCP_BEARER_ENV]);
  });

  it("allows nothing that runs code, reaches the network or spawns subagents", () => {
    for (const tool of ["bash", "eval", "web_search", "task"]) {
      assert.notInclude(OMP_EPHEMERAL_TOOLS, tool);
    }
    const state = (names: ReadonlyArray<string>) => ({
      dumpTools: names.map((name) => ({ name })),
    });
    assert.deepEqual(ompToolsBeyondAllowlist(state(["read", "write", "todo"])), []);
    assert.deepEqual(ompToolsBeyondAllowlist(state(["read", "mcp__memory__save", "bash"])), [
      "mcp__memory__save",
      "bash",
    ]);
    assert.isUndefined(ompToolsBeyondAllowlist({ model: null }));
  });

  it("disables every hosted model provider and foreign config source", () => {
    const overlay = ompEphemeralOverlay([
      { provider: "omlx", baseUrl: "http://127.0.0.1:8000/v1" },
      { provider: "omlx", baseUrl: "http://127.0.0.1:8000/v1" },
      { provider: "opencode-go", baseUrl: "https://opencode.ai/zen/v1" },
      { provider: "apple", baseUrl: "apple-foundation-models://local" },
      { provider: "lm-studio", baseUrl: "http://[::1]:1234/v1" },
    ]);
    const list = (key: string) =>
      Array.from(
        overlay
          .split(`${key}:`)[1]!
          .split(/\n(?! {2}- )/u)[0]!
          .matchAll(/- "([^"]+)"/gu),
        (match) => match[1],
      );

    assert.deepEqual(list("disabledProviders"), [
      "opencode-go",
      "apple",
      ...OMP_FOREIGN_CONFIG_SOURCES,
    ]);
    assert.notInclude(list("disabledProviders"), "native");
    assert.deepEqual(list("enabledModels"), ["omlx/*", "lm-studio/*"]);
    assert.include(overlay, 'memory:\n  backend: "off"');
    assert.include(overlay, "fetch:\n  enabled: false");
  });
});
