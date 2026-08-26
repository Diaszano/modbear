import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  HealthScanOptions,
  ModuleScanner,
  ScanTrigger,
  VulnerabilityScanOptions,
} from "../../orchestration/moduleScanner";
import { AnalysisCache } from "../../cache/analysisCache";
import { VulnerabilityCoordinator } from "../../analyzers/vulnerabilityAnalyzer";
import type { DependencyStatus } from "../../domain/analysis";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface ScannerModule {
  ModuleScanner: typeof ModuleScanner;
}

type PhaseName = "updates" | "replacements" | "vulnerabilities" | "tidy" | "toolchain";

interface PhaseControl {
  calls: number;
  lastArgs: unknown[] | undefined;
  impl: ((...args: unknown[]) => Promise<unknown>) | undefined;
}

const phases: Record<PhaseName, PhaseControl> = {
  updates: { calls: 0, lastArgs: undefined, impl: undefined },
  replacements: { calls: 0, lastArgs: undefined, impl: undefined },
  vulnerabilities: { calls: 0, lastArgs: undefined, impl: undefined },
  tidy: { calls: 0, lastArgs: undefined, impl: undefined },
  toolchain: { calls: 0, lastArgs: undefined, impl: undefined },
};

function stubPhase(name: PhaseName): (...args: unknown[]) => Promise<unknown> {
  return (...args: unknown[]) => {
    const control = phases[name];
    control.calls++;
    control.lastArgs = args;
    if (!control.impl) throw new Error(`No impl installed for phase ${name}`);
    return control.impl(...args);
  };
}

function resetPhases(): void {
  const baseDependency: DependencyStatus = {
    modulePath: "example.com/foo",
    installedVersion: "v1.0.0",
    availableVersion: "v1.1.0",
    updateKind: "minor",
    retractionRationales: [],
    errors: [],
  };
  phases.updates.impl = async () => [baseDependency];
  phases.replacements.impl = async () => [
    { sourcePath: "example.com/local", targetPath: "../local", local: true, exists: true },
  ];
  phases.vulnerabilities.impl = async () => ({
    state: "unavailable",
    findings: [],
    advisories: {},
    errors: [],
  });
  phases.tidy.impl = async () => ({
    state: "complete",
    consistent: true,
    errors: [],
    scannedAt: new Date().toISOString(),
  });
  phases.toolchain.impl = async () => ({
    state: "complete",
    installed: "go1.24.0",
    errors: [],
    scannedAt: new Date().toISOString(),
  });
  for (const control of Object.values(phases)) {
    control.calls = 0;
    control.lastArgs = undefined;
  }
}

let loadPromise: Promise<ScannerModule> | undefined;

async function loadUnderTest(): Promise<ScannerModule> {
  if (loadPromise) return loadPromise;
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (parent?.filename.endsWith("moduleScanner.js")) {
      if (request.endsWith("updateAnalyzer")) {
        return { analyzeUpdates: stubPhase("updates"), buildGoListArgs: () => [] };
      }
      if (request.endsWith("replacementAnalyzer")) {
        return {
          analyzeReplacements: stubPhase("replacements"),
          attachReplacementStatuses: (dependencies: readonly DependencyStatus[]) =>
            dependencies.map((dependency) => ({ ...dependency })),
        };
      }
      if (request.endsWith("vulnerabilityAnalyzer")) {
        return { analyzeVulnerabilities: stubPhase("vulnerabilities") };
      }
      if (request.endsWith("tidyAnalyzer")) {
        return { analyzeTidy: stubPhase("tidy") };
      }
      if (request.endsWith("toolchainAnalyzer")) {
        return { analyzeToolchain: stubPhase("toolchain") };
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    loadPromise = import("../../orchestration/moduleScanner.js");
    return await loadPromise;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

interface Fixture {
  tmpDir: string;
  goModPath: string;
}

async function createFixture(): Promise<Fixture> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-composition-"));
  const goModPath = path.join(tmpDir, "go.mod");
  await writeFile(goModPath, "module example.com/test\n\ngo 1.22\n\nrequire example.com/foo v1.0.0\n");
  return { tmpDir, goModPath };
}

async function disposeFixture(fixture: Fixture): Promise<void> {
  await rm(fixture.tmpDir, { recursive: true, force: true });
}

function buildVulnerabilityOptions(overrides: Partial<VulnerabilityScanOptions> = {}): VulnerabilityScanOptions {
  return {
    enabled: true,
    govulncheckPath: "govulncheck",
    timeoutMs: 1000,
    ttlMs: 360 * 60000,
    includeTests: false,
    buildTags: [],
    database: "",
    importedSeverity: "warning",
    coordinator: new VulnerabilityCoordinator(),
    ...overrides,
  };
}

function buildHealthOptions(overrides: Partial<HealthScanOptions> = {}): HealthScanOptions {
  return { tidyEnabled: true, ttlMs: 10 * 60000, ...overrides };
}

async function scanOnce(
  fixture: Fixture,
  options: {
    vulnerability?: VulnerabilityScanOptions;
    health?: HealthScanOptions;
    trigger?: ScanTrigger;
  } = {},
) {
  const underTest = await loadUnderTest();
  const cache = new AnalysisCache(path.join(fixture.tmpDir, "cache"));
  const scanner = new underTest.ModuleScanner(
    cache,
    "go",
    5000,
    60 * 60000,
    undefined,
    options.vulnerability ?? buildVulnerabilityOptions(),
    options.health ?? buildHealthOptions(),
  );
  const moduleContext = { id: "comp-module", moduleRoot: fixture.tmpDir, goModPath: fixture.goModPath };
  return scanner.scan(moduleContext, new AbortController().signal, options.trigger ?? "save");
}

test("background scans skip tidy while save and manual scans run it exactly once per attempt", async () => {
  resetPhases();
  const fixture = await createFixture();
  try {
    const background = await scanOnce(fixture, { trigger: "background" });
    assert.equal(phases.tidy.calls, 0);
    assert.equal(background.tidy, undefined);
    assert.equal(background.toolchain?.state, "complete");
    assert.equal(background.vulnerabilities.state, "unavailable");
    assert.equal(background.dependencies.length, 1);

    await writeFile(fixture.goModPath, "module example.com/test\n\ngo 1.22\n\nrequire example.com/foo v1.0.1\n");
    const saved = await scanOnce(fixture, { trigger: "save" });
    assert.equal(phases.tidy.calls, 1);
    assert.equal(saved.tidy?.state, "complete");
    assert.equal(saved.tidy?.consistent, true);

    await writeFile(fixture.goModPath, "module example.com/test\n\ngo 1.22\n\nrequire example.com/foo v1.0.2\n");
    await scanOnce(fixture, { trigger: "manual" });
    assert.equal(phases.tidy.calls, 2);
  } finally {
    await disposeFixture(fixture);
  }
});

test("disabling tidy keeps the phase out of save snapshots", async () => {
  resetPhases();
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture, { health: buildHealthOptions({ tidyEnabled: false }) });
    assert.equal(phases.tidy.calls, 0);
    assert.equal(snapshot.tidy, undefined);
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed update phase yields a partial snapshot that preserves other phases", async () => {
  resetPhases();
  phases.updates.impl = async () => {
    throw new Error("go list exploded");
  };
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture);
    assert.equal(snapshot.updateState, "partial");
    assert.deepEqual(snapshot.dependencies, []);
    assert.equal(snapshot.replacements.length, 1);
    assert.equal(snapshot.vulnerabilities.state, "unavailable");
    assert.equal(snapshot.tidy?.state, "complete");
    assert.equal(snapshot.toolchain?.state, "complete");
    assert.equal(snapshot.errors.length, 1);
    assert.equal(snapshot.errors[0]?.code, "unknown");
    assert.equal(snapshot.errors[0]?.message, "go list exploded");
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed replacement phase yields a partial snapshot that preserves dependency data", async () => {
  resetPhases();
  phases.replacements.impl = async () => {
    throw new Error("replacement stat failed");
  };
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture);
    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.dependencies.length, 1);
    assert.equal(snapshot.dependencies[0]?.availableVersion, "v1.1.0");
    assert.deepEqual(snapshot.replacements, []);
    assert.equal(snapshot.errors.length, 1);
    assert.equal(snapshot.errors[0]?.message, "replacement stat failed");
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed vulnerability phase degrades to not-run while keeping other results", async () => {
  resetPhases();
  phases.vulnerabilities.impl = async () => {
    throw new Error("govulncheck exploded");
  };
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture);
    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.dependencies.length, 1);
    assert.equal(snapshot.vulnerabilities.state, "not-run");
    assert.deepEqual(snapshot.vulnerabilities.findings, []);
    assert.equal(snapshot.errors.length, 1);
    assert.equal(snapshot.errors[0]?.message, "govulncheck exploded");
    assert.equal(snapshot.tidy?.state, "complete");
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed tidy phase records the error and keeps the rest of the snapshot", async () => {
  resetPhases();
  phases.tidy.impl = async () => {
    throw new Error("tidy exploded");
  };
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture);
    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.tidy?.state, "failed");
    assert.equal(snapshot.tidy?.consistent, false);
    assert.equal(snapshot.dependencies.length, 1);
    assert.equal(snapshot.toolchain?.state, "complete");
    assert.equal(snapshot.errors.length, 1);
    assert.equal(snapshot.errors[0]?.message, "tidy exploded");
  } finally {
    await disposeFixture(fixture);
  }
});

test("a failed toolchain phase records the error and keeps the rest of the snapshot", async () => {
  resetPhases();
  phases.toolchain.impl = async () => {
    throw new Error("go env exploded");
  };
  const fixture = await createFixture();
  try {
    const snapshot = await scanOnce(fixture);
    assert.equal(snapshot.updateState, "partial");
    assert.equal(snapshot.toolchain?.state, "failed");
    assert.equal(snapshot.dependencies.length, 1);
    assert.equal(snapshot.tidy?.state, "complete");
    assert.equal(snapshot.errors.length, 1);
    assert.equal(snapshot.errors[0]?.message, "go env exploded");
  } finally {
    await disposeFixture(fixture);
  }
});

test("cancelled scans propagate instead of producing partial snapshots", async () => {
  resetPhases();
  phases.updates.impl = async () => {
    throw new Error("aborted work");
  };
  const fixture = await createFixture();
  try {
    const underTest = await loadUnderTest();
    const cache = new AnalysisCache(path.join(fixture.tmpDir, "cache"));
    const scanner = new underTest.ModuleScanner(
      cache,
      "go",
      5000,
      60 * 60000,
      undefined,
      buildVulnerabilityOptions(),
      buildHealthOptions(),
    );
    const moduleContext = { id: "comp-module", moduleRoot: fixture.tmpDir, goModPath: fixture.goModPath };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(scanner.scan(moduleContext, controller.signal, "save"), /aborted work/);
    assert.ok(controller.signal.aborted);
  } finally {
    await disposeFixture(fixture);
  }
});

test("changing vulnerability or tidy options invalidates cached snapshots", async () => {
  resetPhases();
  const fixture = await createFixture();
  try {
    await scanOnce(fixture);
    assert.equal(phases.updates.calls, 1);

    await scanOnce(fixture, {
      vulnerability: buildVulnerabilityOptions({ buildTags: ["integration"] }),
    });
    assert.equal(phases.updates.calls, 2);

    await scanOnce(fixture, {
      vulnerability: buildVulnerabilityOptions({ importedSeverity: "error" }),
    });
    assert.equal(phases.updates.calls, 3);

    await scanOnce(fixture, {
      vulnerability: buildVulnerabilityOptions({ database: "https://example.test/db" }),
    });
    assert.equal(phases.updates.calls, 4);

    await scanOnce(fixture, { health: buildHealthOptions({ tidyEnabled: false }) });
    assert.equal(phases.updates.calls, 5);
  } finally {
    await disposeFixture(fixture);
  }
});

test("per-phase TTLs reuse fresh update and vulnerability results while rerunning expired tidy", async () => {
  resetPhases();
  const fixture = await createFixture();
  try {
    const underTest = await loadUnderTest();
    const cache = new AnalysisCache(path.join(fixture.tmpDir, "cache"));
    const scanner = new underTest.ModuleScanner(
      cache,
      "go",
      5000,
      60 * 60000,
      undefined,
      buildVulnerabilityOptions(),
      buildHealthOptions({ ttlMs: 1 }),
    );
    const moduleContext = { id: "comp-module", moduleRoot: fixture.tmpDir, goModPath: fixture.goModPath };
    const first = await scanner.scan(moduleContext, new AbortController().signal, "save");
    assert.equal(phases.updates.calls, 1);

    phases.updates.impl = async () => [
      {
        modulePath: "example.com/foo",
        installedVersion: "v9.9.9",
        availableVersion: "v9.9.10",
        updateKind: "patch" as const,
        retractionRationales: [],
        errors: [],
      },
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await scanner.scan(moduleContext, new AbortController().signal, "save");
    assert.equal(phases.updates.calls, 1);
    assert.equal(phases.vulnerabilities.calls, 1);
    assert.equal(phases.tidy.calls, 2);
    assert.equal(second.dependencies[0]?.installedVersion, first.dependencies[0]?.installedVersion);
    assert.equal(second.contentHash, first.contentHash);
    assert.equal(second.updateState, "complete");
    assert.ok(second.tidy);
  } finally {
    await disposeFixture(fixture);
  }
});
