import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModuleScanner } from "../../orchestration/moduleScanner";
import { AnalysisCache } from "../../cache/analysisCache";
import { VulnerabilityCoordinator } from "../../analyzers/vulnerabilityAnalyzer";
import type { Logger } from "../../logging/logger";

test("ModuleScanner logs targeted go list arguments when update analysis becomes partial", async () => {
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
    const snapshot = await scanner.scan(moduleContext, controller.signal);

    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.dependencies.length, 0);

    assert.equal(loggedCommands.length, 1);
    const cmd = loggedCommands[0]!;
    assert.equal(cmd.executable, "missing-go-for-logging-test");
    assert.deepEqual(cmd.args, ["list", "-m", "-u", "-json", "-mod=readonly", "example.com/foo"]);
    assert.equal(cmd.cwd, tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("ModuleScanner skips tidy for background scans and preserves other phase results", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-scanner-health-"));
  try {
    const goModPath = path.join(tmpDir, "go.mod");
    const tidyCallsPath = path.join(tmpDir, "tidy-calls");
    const goExecutable = path.join(tmpDir, "go");
    await writeFile(goModPath, "module example.com/test\n\ngo 1.24.0\n\nrequire example.com/foo v1.0.0\n");
    await writeFile(tidyCallsPath, "0");
    await writeFile(goExecutable, `#!/usr/bin/env node
const fs = require("node:fs");
const [command, ...args] = process.argv.slice(2);
if (command === "version") process.stdout.write("go version go1.25.0 linux/amd64\\n");
if (command === "env") process.stdout.write("go1.25.0\\n");
if (command === "list") process.stdout.write(JSON.stringify({ Path: "example.com/foo", Version: "v1.0.0", Update: { Version: "v1.1.0" } }));
if (command === "mod" && args[0] === "tidy") fs.writeFileSync(${JSON.stringify(tidyCallsPath)}, String(Number(fs.readFileSync(${JSON.stringify(tidyCallsPath)}, "utf8")) + 1));
`);
    await chmod(goExecutable, 0o755);

    const scanner = new ModuleScanner(
      new AnalysisCache(path.join(tmpDir, "cache")),
      goExecutable,
      5_000,
      60_000,
      undefined,
      {
        enabled: true,
        govulncheckPath: path.join(tmpDir, "missing-govulncheck"),
        timeoutMs: 5_000,
        coordinator: new VulnerabilityCoordinator()
      },
      { tidyEnabled: true, tidyTtlMs: 60_000, vulnerabilityTtlMs: 60_000 }
    );
    const module = { id: "test-module", moduleRoot: tmpDir, goModPath };

    const background = await scanner.scan(module, new AbortController().signal, "background");
    assert.equal(await readFile(tidyCallsPath, "utf8"), "0");
    assert.equal(background.toolchain.state, "complete");
    assert.equal(background.vulnerabilities.state, "unavailable");
    assert.equal(background.dependencies.length, 1);
    assert.equal(background.updateState, "partial");

    const saved = await scanner.scan(module, new AbortController().signal, "save");
    assert.equal(await readFile(tidyCallsPath, "utf8"), "1");
    assert.equal(saved.tidy.state, "complete");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("ModuleScanner returns a partial snapshot when toolchain analysis fails", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-scanner-partial-"));
  try {
    const goModPath = path.join(tmpDir, "go.mod");
    const goExecutable = path.join(tmpDir, "go");
    await writeFile(goModPath, "module example.com/test\n\ngo 1.24.0\n\nrequire example.com/foo v1.0.0\n");
    await writeFile(goExecutable, `#!/usr/bin/env node
const [command] = process.argv.slice(2);
if (command === "version") process.stdout.write("go version go1.25.0 linux/amd64\\n");
if (command === "env") process.stdout.write("not-a-go-version\\n");
if (command === "list") process.stdout.write(JSON.stringify({ Path: "example.com/foo", Version: "v1.0.0" }));
`);
    await chmod(goExecutable, 0o755);

    const scanner = new ModuleScanner(
      new AnalysisCache(path.join(tmpDir, "cache")),
      goExecutable,
      5_000,
      60_000,
      undefined,
      undefined,
      { tidyEnabled: true, tidyTtlMs: 60_000, vulnerabilityTtlMs: 60_000 }
    );

    const snapshot = await scanner.scan({ id: "test-module", moduleRoot: tmpDir, goModPath }, new AbortController().signal, "background");
    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.dependencies.length, 1);
    assert.equal(snapshot.toolchain.state, "failed");
    assert.equal(snapshot.vulnerabilities.state, "not-run");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
