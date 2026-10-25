// @effect-diagnostics nodeBuiltinImport:off -- Pi extensions run outside Effect; these tests exercise their native filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";
import { assert, describe, it } from "@effect/vitest";

import { T3_PI_EPHEMERAL_ROOT_ENV } from "./ephemeralWriteGuard.ts";
import { PI_T3_MCP_EXTENSION_SOURCE, T3_PI_RUNTIME_MODE_ENV } from "./mcpExtensionSource.ts";

type ToolCallHook = (
  event: { toolName: string; input: unknown },
  ctx: { cwd: string; ui: { confirm: () => Promise<boolean> } },
) => Promise<{ block: true; reason: string } | undefined>;

// Loader mirrors mcpExtensionSource.fork.test.ts.
async function loadToolCallHook(env: Record<string, string>) {
  const handlers = new Map<string, unknown>();
  const source = NodeModule.stripTypeScriptTypes(
    PI_T3_MCP_EXTENSION_SOURCE.replace(/^import .*;$/gm, "").replace(
      "export default async function",
      "async function",
    ),
  );
  await NodeVM.runInNewContext(`${source}\nt3McpExtension(pi)`, {
    process: { env },
    NodeFSP,
    NodePath,
    stripFrontmatter: (content: string) => content,
    pi: { on: (name: string, handler: unknown) => handlers.set(name, handler) },
  });
  const hook = handlers.get("tool_call");
  assert.isDefined(hook);
  return hook as ToolCallHook;
}

describe("ephemeral write guard (fork patch 11)", () => {
  it.each(["full-access", "approval-required"])(
    "writes inside the Scratch folder without a prompt and never outside it (%s)",
    async (runtimeMode) => {
      const base = await NodeFSP.realpath(
        await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-ephemeral-guard-")),
      );
      try {
        const root = NodePath.join(base, "scratch", "2026-10-25-thread");
        const outside = NodePath.join(base, "outside");
        await NodeFSP.mkdir(root, { recursive: true });
        await NodeFSP.mkdir(outside);
        await NodeFSP.writeFile(NodePath.join(outside, "target.txt"), "outside");
        await NodeFSP.symlink(outside, NodePath.join(root, "linked-folder"));
        await NodeFSP.symlink(
          NodePath.join(outside, "target.txt"),
          NodePath.join(root, "linked-file.txt"),
        );
        const hook = await loadToolCallHook({
          [T3_PI_EPHEMERAL_ROOT_ENV]: root,
          [T3_PI_RUNTIME_MODE_ENV]: runtimeMode,
        });
        const ctx = { cwd: root, ui: { confirm: () => assert.fail("no prompt expected") } };
        const write = (path: string) =>
          hook({ toolName: "write", input: { path, content: "text" } }, ctx);

        for (const path of ["notes.txt", "nested/new/notes.txt", NodePath.join(root, "a.txt")]) {
          assert.isUndefined(await write(path), path);
        }
        assert.isUndefined(
          await hook(
            { toolName: "edit", input: { path: "notes.txt", old_string: "a", new_string: "b" } },
            ctx,
          ),
        );
        for (const path of [
          "../outside.txt",
          NodePath.join(outside, "new.txt"),
          "linked-folder/new.txt",
          "linked-file.txt",
          ".",
          "~/notes.txt",
          "@/etc/notes.txt",
          ":/etc/notes.txt",
          `file://${outside}/new.txt`,
          "[notes.txt#ABCD]",
          " notes.txt",
        ]) {
          assert.isTrue((await write(path))?.block, path);
        }
        for (const input of [
          { input: "@@ notes.txt\n+text" },
          { path: "notes.txt", edits: [{ rename: "../outside.txt" }] },
          { path: 42 },
        ]) {
          assert.isTrue((await hook({ toolName: "edit", input }, ctx))?.block);
        }
      } finally {
        await NodeFSP.rm(base, { recursive: true });
      }
    },
  );
});
