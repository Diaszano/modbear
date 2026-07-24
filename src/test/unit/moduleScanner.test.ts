import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModuleScanner } from "../../orchestration/moduleScanner";
import { AnalysisCache } from "../../cache/analysisCache";
import type { Logger } from "../../logging/logger";

test("ModuleScanner logs targeted go list arguments before a process failure", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-scanner-"));
  try {
    const goModPath = path.join(tmpDir, "go.mod");
    await writeFile(goModPath, "module example.com/test\n\ngo 1.22\n\nrequire example.com/foo v1.0.0\n");

    const cache = new AnalysisCache(path.join(tmpDir, "cache"));
    const loggedCommands: { executable: string; args: readonly string[]; cwd: string }[] = [];
    const mockLogger = {
      command(executable: string, args: readonly string[], cwd: string) {
        loggedCommands.push({ executable, args, cwd });
      }
    } as unknown as Logger;

    const scanner = new ModuleScanner(cache, "missing-go-for-logging-test", 5000, 60000, mockLogger);
    const moduleContext = {
      id: "test-module",
      moduleRoot: tmpDir,
      goModPath
    };

    const controller = new AbortController();
    await assert.rejects(scanner.scan(moduleContext, controller.signal));

    assert.equal(loggedCommands.length, 1);
    const cmd = loggedCommands[0]!;
    assert.equal(cmd.executable, "missing-go-for-logging-test");
    assert.deepEqual(cmd.args, ["list", "-m", "-u", "-json", "-mod=readonly", "example.com/foo"]);
    assert.equal(cmd.cwd, tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
