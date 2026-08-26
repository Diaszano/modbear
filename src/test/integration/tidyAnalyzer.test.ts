import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeTidy, buildTidyArgs } from "../../analyzers/tidyAnalyzer";
import type { ModuleContext } from "../../domain/module";

const fakeGoPreload = path.resolve("src/test/fixtures/fake-go-tidy.cjs");
const unifiedDiff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1,3 +1,3 @@\n";

function installFakeGo(): () => void {
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previousNodeOptions, `--require ${fakeGoPreload}`].filter(Boolean).join(" ");
  return () => {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
  };
}

function setTidyMode(mode: string | undefined): () => void {
  const previousMode = process.env.MODBEAR_FAKE_TIDY;
  if (mode === undefined) delete process.env.MODBEAR_FAKE_TIDY;
  else process.env.MODBEAR_FAKE_TIDY = mode;
  return () => {
    if (previousMode === undefined) delete process.env.MODBEAR_FAKE_TIDY;
    else process.env.MODBEAR_FAKE_TIDY = previousMode;
  };
}

async function createFixtureModule(): Promise<{ module: ModuleContext; cleanup: () => Promise<void> }> {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-tidy-analyzer-"));
  await writeFile(path.join(moduleRoot, "go.mod"), "module example.com/fixture\n\ngo 1.23\n");
  await writeFile(path.join(moduleRoot, "go.sum"), "example.com/dep v0.1.0 h1:test=\n");
  return {
    module: { id: "fixture", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
    cleanup: () => rm(moduleRoot, { recursive: true, force: true }),
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

test("runs the exact read-only go mod tidy -diff argument contract", async () => {
  const restoreNodeOptions = installFakeGo();
  const { module, cleanup } = await createFixtureModule();
  const argsFile = path.join(module.moduleRoot, "args.json");
  const restoreMode = setTidyMode(undefined);
  process.env.MODBEAR_FAKE_TIDY_ARGS = argsFile;
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "complete");
    const recordedArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    assert.deepEqual(
      recordedArgs.map((arg, index) => (index === 0 ? path.basename(arg) : arg)),
      ["mod", "tidy", "-diff"],
    );
    assert.deepEqual(buildTidyArgs(), ["mod", "tidy", "-diff"]);
  } finally {
    delete process.env.MODBEAR_FAKE_TIDY_ARGS;
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("reports a consistent module for a silent successful tidy exit", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setTidyMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "complete");
    assert.equal(analysis.consistent, true);
    assert.equal(analysis.diff, undefined);
    assert.deepEqual(analysis.errors, []);
    assert.ok(analysis.scannedAt);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("captures an inconsistent-tidy diff as a complete result", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setTidyMode("diff");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "complete");
    assert.equal(analysis.consistent, false);
    assert.equal(analysis.diff, unifiedDiff);
    assert.deepEqual(analysis.errors, []);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("maps a package-loading failure to a failed analysis", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setTidyMode("error");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "failed");
    assert.equal(analysis.consistent, false);
    assert.deepEqual(
      analysis.errors.map((error) => error.message),
      ["go: missing: no matching versions"],
    );
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a hung tidy command as a timeout failure", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setTidyMode("hang");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 100,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "failed");
    assert.deepEqual(
      analysis.errors.map((error) => error.code),
      ["timeout"],
    );
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a cancelled scan without spawning a process", async () => {
  const controller = new AbortController();
  controller.abort();
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeTidy({
      module,
      goExecutable: "go",
      timeoutMs: 2_000,
      signal: controller.signal,
    });
    assert.equal(analysis.state, "failed");
    assert.deepEqual(
      analysis.errors.map((error) => error.code),
      ["cancelled"],
    );
  } finally {
    await cleanup();
  }
});

test("never mutates go.mod or go.sum while analyzing", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setTidyMode("diff");
  const { module, cleanup } = await createFixtureModule();
  try {
    const goModPath = path.join(module.moduleRoot, "go.mod");
    const goSumPath = path.join(module.moduleRoot, "go.sum");
    const beforeGoMod = await sha256(goModPath);
    const beforeGoSum = await sha256(goSumPath);
    await analyzeTidy({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(await sha256(goModPath), beforeGoMod);
    assert.equal(await sha256(goSumPath), beforeGoSum);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});
