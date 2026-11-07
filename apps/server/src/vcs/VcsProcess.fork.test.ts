import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "./VcsProcess.ts";

const output = (code: number, stderr: string): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

// Git on macOS follows the system language when LANG is unset, as in a Finder-launched app.
const indexLockedOnce = () => {
  let attempts = 0;
  const service = VcsProcess.make.pipe(
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: (input) =>
          Effect.sync(() => {
            attempts += 1;
            if (attempts > 1) return output(0, "");
            return output(
              128,
              input.env?.LANGUAGE === "C"
                ? "fatal: Unable to create '/workspace/.git/index.lock': File exists.\n"
                : "致命錯誤: 無法建立「/workspace/.git/index.lock」：File exists。\n",
            );
          }),
      }),
    ),
  );
  return { service, attempts: () => attempts };
};

describe("VcsProcess.run (fork)", () => {
  it.effect("explains a held index lock from a Git that speaks the system language", () =>
    Effect.gen(function* () {
      const service = yield* indexLockedOnce().service;
      const error = yield* service
        .run({ operation: "test.commit", command: "git", args: ["commit"], cwd: "/workspace" })
        .pipe(Effect.flip);

      expect(error._tag === "VcsProcessExitError" && error.detail).toBe(
        VcsProcess.GIT_INDEX_LOCKED_DETAIL,
      );
    }),
  );

  it.effect("retries a checkpoint command whose Git would report a held lock in Chinese", () =>
    Effect.gen(function* () {
      const fake = indexLockedOnce();
      const service = yield* fake.service;

      const capture = yield* service
        .run({
          operation: VcsProcess.CHECKPOINT_CAPTURE_OPERATION,
          command: "git",
          args: ["add", "--all"],
          cwd: "/workspace",
        })
        .pipe(Effect.exit, Effect.forkChild({ startImmediately: true }));
      yield* TestClock.adjust("1 second");

      expect(Exit.isSuccess(yield* Fiber.join(capture))).toBe(true);
      expect(fake.attempts()).toBe(2);
    }),
  );
});
