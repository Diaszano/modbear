import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runProcess, ProcessExecutionError } from "../../execution/processRunner";

const tool = path.resolve("src/test/fixtures/fake-tool.mjs");

test("passes arguments without shell interpolation", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: [tool, "echo", "$(touch should-not-exist)"],
    cwd: process.cwd(),
    timeoutMs: 2_000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), "$(touch should-not-exist)");
});

test("captures a non-zero exit for the caller to classify", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: [tool, "fail"],
    cwd: process.cwd(),
    timeoutMs: 2_000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024
  });
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /password/);
});

test("times out and marks the result", async () => {
  await assert.rejects(
    runProcess({
      executable: process.execPath,
      args: [tool, "sleep", "5000"],
      cwd: process.cwd(),
      timeoutMs: 20,
      stdoutLimitBytes: 1024,
      stderrLimitBytes: 1024
    }),
    (err: unknown) => {
      if (err instanceof ProcessExecutionError) {
        assert.equal(err.kind, "timeout");
        return /timed out/.test(err.message);
      }
      return false;
    }
  );
});

test("cancels execution when AbortSignal is aborted", async () => {
  const controller = new AbortController();
  const promise = runProcess({
    executable: process.execPath,
    args: [tool, "sleep", "5000"],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(promise, (err: unknown) => {
    if (err instanceof ProcessExecutionError) {
      assert.equal(err.kind, "cancelled");
      return true;
    }
    return false;
  });
});

test("rejects when stdout exceeds output limit", async () => {
  await assert.rejects(
    runProcess({
      executable: process.execPath,
      args: [tool, "echo", "1234567890"],
      cwd: process.cwd(),
      timeoutMs: 2_000,
      stdoutLimitBytes: 5,
      stderrLimitBytes: 1024
    }),
    (err: unknown) => {
      if (err instanceof ProcessExecutionError) {
        assert.equal(err.kind, "output-limit");
        return true;
      }
      return false;
    }
  );
});
