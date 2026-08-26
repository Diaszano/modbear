import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildWhyArgs, explainDependency } from "../../analyzers/whyAnalyzer";
import type { ModuleContext } from "../../domain/module";

const fakeGoPreload = path.resolve("src/test/fixtures/fake-go-why.cjs");

function installFakeGo(): () => void {
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previousNodeOptions, `--require ${fakeGoPreload}`].filter(Boolean).join(" ");
  return () => {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
  };
}

function setWhyMode(mode: string | undefined): () => void {
  const previousMode = process.env.MODBEAR_FAKE_WHY;
  if (mode === undefined) delete process.env.MODBEAR_FAKE_WHY;
  else process.env.MODBEAR_FAKE_WHY = mode;
  return () => {
    if (previousMode === undefined) delete process.env.MODBEAR_FAKE_WHY;
    else process.env.MODBEAR_FAKE_WHY = previousMode;
  };
}

async function createFixtureModule(): Promise<{ module: ModuleContext; cleanup: () => Promise<void> }> {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-why-analyzer-"));
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

test("runs the exact go mod why -m argument contract", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setWhyMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  const argsFile = path.join(module.moduleRoot, "args.json");
  process.env.MODBEAR_FAKE_WHY_ARGS = argsFile;
  try {
    const explanation = await explainDependency({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      modulePath: "example.com/library",
    });
    assert.match(explanation, /# example\.com\/fixture/);
    const recordedArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    assert.deepEqual(
      recordedArgs.map((arg, index) => (index === 0 ? path.basename(arg) : arg)),
      ["mod", "why", "-m", "example.com/library"],
    );
    assert.deepEqual(buildWhyArgs("example.com/library"), ["mod", "why", "-m", "example.com/library"]);
  } finally {
    delete process.env.MODBEAR_FAKE_WHY_ARGS;
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("returns the dependency explanation on a successful run", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setWhyMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  try {
    const explanation = await explainDependency({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      modulePath: "example.com/library",
    });
    assert.equal(explanation, "# example.com/fixture\nexample.com/fixture\nexample.com/library");
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("rejects with the stderr message when go mod why exits nonzero", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setWhyMode("error");
  const { module, cleanup } = await createFixtureModule();
  try {
    await assert.rejects(
      explainDependency({
        module,
        goExecutable: process.execPath,
        timeoutMs: 2_000,
        signal: new AbortController().signal,
        modulePath: "example.com/library",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "go: example.com/library: module is not required");
        return true;
      },
    );
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a hung go mod why command as a timeout failure", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setWhyMode("hang");
  const { module, cleanup } = await createFixtureModule();
  try {
    await assert.rejects(
      explainDependency({
        module,
        goExecutable: process.execPath,
        timeoutMs: 100,
        signal: new AbortController().signal,
        modulePath: "example.com/library",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "timeout");
        return true;
      },
    );
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a cancelled explanation without spawning a process", async () => {
  const controller = new AbortController();
  controller.abort();
  const { module, cleanup } = await createFixtureModule();
  try {
    await assert.rejects(
      explainDependency({
        module,
        goExecutable: "go",
        timeoutMs: 2_000,
        signal: controller.signal,
        modulePath: "example.com/library",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "cancelled");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("classifies a missing Go executable as tool-not-found", async () => {
  const { module, cleanup } = await createFixtureModule();
  try {
    await assert.rejects(
      explainDependency({
        module,
        goExecutable: path.join(module.moduleRoot, "no-such-go"),
        timeoutMs: 2_000,
        signal: new AbortController().signal,
        modulePath: "example.com/library",
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "tool-not-found");
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test("never mutates go.mod or go.sum while explaining", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setWhyMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  try {
    const goModPath = path.join(module.moduleRoot, "go.mod");
    const goSumPath = path.join(module.moduleRoot, "go.sum");
    const beforeGoMod = await sha256(goModPath);
    const beforeGoSum = await sha256(goSumPath);
    await explainDependency({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      modulePath: "example.com/library",
    });
    assert.equal(await sha256(goModPath), beforeGoMod);
    assert.equal(await sha256(goSumPath), beforeGoSum);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});
