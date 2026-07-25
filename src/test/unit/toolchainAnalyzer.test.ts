import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeToolchain } from "../../analyzers/toolchainAnalyzer";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

test("runs go env with exact arguments and preserves directive values", async () => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-toolchain-"));
  try {
    const argsPath = path.join(moduleRoot, "args.json");
    const executable = path.join(moduleRoot, "go");
    await writeFile(
      executable,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\nfs.writeSync(process.stdout.fd, 'go1.25.0\\n');\n`
    );
    await chmod(executable, 0o755);

    const analysis = await analyzeToolchain({
      module: { id: "module", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
      parsed: parseGoModPositions("module example.com/app\n\ngo 1.24.0\ntoolchain go1.25.0\n"),
      goExecutable: executable,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    });

    const recorded = { args: JSON.parse(await readFile(argsPath, "utf8")) as string[] };
    assert.deepEqual(recorded.args, ["env", "GOVERSION", "GOWORK"]);
    assert.deepEqual(analysis, {
      state: "complete",
      installed: "go1.25.0",
      required: "1.24.0",
      suggested: "go1.25.0",
      errors: []
    });
  } finally {
    await rm(moduleRoot, { recursive: true, force: true });
  }
});

test("does not execute a toolchain command for an untrusted workspace", async () => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-toolchain-untrusted-"));
  try {
    const marker = path.join(moduleRoot, "invoked");
    const executable = path.join(moduleRoot, "go");
    await writeFile(executable, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    await chmod(executable, 0o755);

    const analysis = await analyzeToolchain({
      module: { id: "module", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
      parsed: parseGoModPositions("module example.com/app\n\ngo 1.24.0\n"),
      goExecutable: executable,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      workspaceTrusted: false
    });

    await assert.rejects(readFile(marker, "utf8"));
    assert.deepEqual(analysis, {
      state: "unavailable",
      required: "1.24.0",
      errors: [{ code: "workspace-untrusted", message: "Toolchain analysis is unavailable." }]
    });
  } finally {
    await rm(moduleRoot, { recursive: true, force: true });
  }
});
