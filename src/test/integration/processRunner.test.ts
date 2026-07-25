import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runProcess, ProcessExecutionError } from "../../execution/processRunner";

const tool = path.resolve("src/test/fixtures/fake-tool.mjs");

async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

test("passes arguments without shell interpolation", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: [tool, "echo", "$(touch should-not-exist)"],
    cwd: process.cwd(),
    timeoutMs: 2_000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
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
    stderrLimitBytes: 1024,
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
      stderrLimitBytes: 1024,
    }),
    (err: unknown) => {
      if (err instanceof ProcessExecutionError) {
        assert.equal(err.kind, "timeout");
        return err.message.includes("timed out");
      }
      return false;
    },
  );
});

test("timeout terminates a spawned grandchild on POSIX", { skip: process.platform === "win32" }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "modbear-process-runner-"));
  const pidFile = path.join(tempDir, "grandchild.pid");
  let grandchildPid: number | undefined;

  try {
    await assert.rejects(
      runProcess({
        executable: process.execPath,
        args: [tool, "spawn-grandchild", pidFile],
        cwd: process.cwd(),
        timeoutMs: 1_000,
        stdoutLimitBytes: 1024,
        stderrLimitBytes: 1024,
      }),
      (err: unknown) => err instanceof ProcessExecutionError && err.kind === "timeout",
    );

    grandchildPid = Number(await readFile(pidFile, "utf8"));
    assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);
    assert.equal(await waitForProcessExit(grandchildPid), true, "grandchild remained running after timeout");
  } finally {
    if (grandchildPid !== undefined) {
      try {
        process.kill(grandchildPid, "SIGKILL");
      } catch {
        // The test assertion expects the process to have already exited.
      }
    }
    await rm(tempDir, { recursive: true, force: true });
  }
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
    signal: controller.signal,
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
      stderrLimitBytes: 1024,
    }),
    (err: unknown) => {
      if (err instanceof ProcessExecutionError) {
        assert.equal(err.kind, "output-limit");
        return true;
      }
      return false;
    },
  );
});
