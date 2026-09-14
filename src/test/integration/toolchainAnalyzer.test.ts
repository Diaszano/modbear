import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeToolchain, buildToolchainArgs } from "../../analyzers/toolchainAnalyzer";
import type { ModuleContext } from "../../domain/module";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

const fakeGoPreload = path.resolve("src/test/fixtures/fake-go-env.cjs");

function installFakeGo(): () => void {
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previousNodeOptions, `--require ${fakeGoPreload}`].filter(Boolean).join(" ");
  return () => {
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
  };
}

function setGoEnvMode(mode: string | undefined): () => void {
  const previousMode = process.env.MODBEAR_FAKE_GOENV;
  if (mode === undefined) delete process.env.MODBEAR_FAKE_GOENV;
  else process.env.MODBEAR_FAKE_GOENV = mode;
  return () => {
    if (previousMode === undefined) delete process.env.MODBEAR_FAKE_GOENV;
    else process.env.MODBEAR_FAKE_GOENV = previousMode;
  };
}

async function createFixtureModule(): Promise<{ module: ModuleContext; cleanup: () => Promise<void> }> {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-toolchain-analyzer-"));
  await writeFile(path.join(moduleRoot, "go.mod"), "module example.com/fixture\n\ngo 1.23\n\ntoolchain go1.24.0\n");
  await writeFile(path.join(moduleRoot, "go.sum"), "example.com/dep v0.1.0 h1:test=\n");
  return {
    module: { id: "fixture", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
    cleanup: () => rm(moduleRoot, { recursive: true, force: true }),
  };
}

async function readDirectives(module: ModuleContext): Promise<{ required?: string; suggested?: string }> {
  const parsed = parseGoModPositions(await readFile(module.goModPath, "utf8"));
  return {
    ...(parsed.go ? { required: parsed.go.version } : {}),
    ...(parsed.toolchain ? { suggested: parsed.toolchain.version } : {}),
  };
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

test("runs the exact go env GOVERSION GOWORK argument contract", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  const argsFile = path.join(module.moduleRoot, "args.json");
  process.env.MODBEAR_FAKE_GOENV_ARGS = argsFile;
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      ...(await readDirectives(module)),
    });
    assert.equal(analysis.state, "complete");
    const recordedArgs = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    assert.deepEqual(
      recordedArgs.map((arg, index) => (index === 0 ? path.basename(arg) : arg)),
      ["env", "GOVERSION", "GOWORK"],
    );
    assert.deepEqual(buildToolchainArgs(), ["env", "GOVERSION", "GOWORK"]);
  } finally {
    delete process.env.MODBEAR_FAKE_GOENV_ARGS;
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("reports the installed version with directive values on a successful run", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
      ...(await readDirectives(module)),
    });
    assert.equal(analysis.state, "complete");
    assert.equal(analysis.installed, "go1.25.1");
    assert.equal(analysis.required, "1.23");
    assert.equal(analysis.suggested, "go1.24.0");
    assert.deepEqual(analysis.errors, []);
    assert.ok(analysis.scannedAt);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("completes without directives and keeps older installed versions for the mapper", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode("old");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "complete");
    assert.equal(analysis.installed, "go1.21.5");
    assert.equal(analysis.required, undefined);
    assert.equal(analysis.suggested, undefined);
    assert.deepEqual(analysis.errors, []);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a nonzero exit as a failed analysis", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode("error");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "failed");
    assert.deepEqual(
      analysis.errors.map((error) => error.message),
      ["go: cannot determine GOROOT"],
    );
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("fails when GOVERSION cannot be parsed", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode("garbage");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "failed");
    assert.match(analysis.errors[0]?.message ?? "", /GOVERSION/);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});

test("classifies a hung go env command as a timeout failure", async () => {
  const restoreNodeOptions = installFakeGo();
  const restoreMode = setGoEnvMode("hang");
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
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

test("classifies a missing Go executable as tool-not-found", async () => {
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
      module,
      goExecutable: path.join(module.moduleRoot, "no-such-go"),
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(analysis.state, "failed");
    assert.deepEqual(
      analysis.errors.map((error) => error.code),
      ["tool-not-found"],
    );
  } finally {
    await cleanup();
  }
});

test("classifies a cancelled scan without spawning a process", async () => {
  const controller = new AbortController();
  controller.abort();
  const { module, cleanup } = await createFixtureModule();
  try {
    const analysis = await analyzeToolchain({
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
  const restoreMode = setGoEnvMode(undefined);
  const { module, cleanup } = await createFixtureModule();
  try {
    const beforeGoMod = await sha256(module.goModPath);
    const goSumPath = path.join(module.moduleRoot, "go.sum");
    const beforeGoSum = await sha256(goSumPath);
    await analyzeToolchain({
      module,
      goExecutable: process.execPath,
      timeoutMs: 2_000,
      signal: new AbortController().signal,
    });
    assert.equal(await sha256(module.goModPath), beforeGoMod);
    assert.equal(await sha256(goSumPath), beforeGoSum);
  } finally {
    restoreMode();
    restoreNodeOptions();
    await cleanup();
  }
});
