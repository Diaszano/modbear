import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { AnalysisCache } from "../../cache/analysisCache";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";

const dummyModule: ModuleContext = {
  id: "mod-1",
  moduleRoot: "/path/to/mod",
  goModPath: "/path/to/mod/go.mod"
};

const mockSnapshot: ModuleAnalysisSnapshot = {
  moduleId: "mod-1",
  contentHash: "hash-123",
  createdAt: "2026-07-21T00:00:00Z",
  stale: false,
  updateState: "complete",
  dependencies: [],
  replacements: [],
  errors: []
};

test("ScanCoordinator stores and retrieves snapshots by moduleId", async () => {
  const coordinator = new ScanCoordinator();
  assert.equal(coordinator.getSnapshot("mod-1"), undefined);

  const snapshot = await coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-123",
    run: async () => mockSnapshot
  });

  assert.deepEqual(snapshot, mockSnapshot);
  assert.deepEqual(coordinator.getSnapshot("mod-1"), mockSnapshot);
  assert.ok(Object.isFrozen(snapshot));
});

test("ScanCoordinator emits snapshot event when scan finishes", async () => {
  const coordinator = new ScanCoordinator();
  const received: ModuleAnalysisSnapshot[] = [];

  const unsubscribe = coordinator.events.onSnapshot((s) => received.push(s));

  await coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-123",
    run: async () => mockSnapshot
  });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], mockSnapshot);

  unsubscribe();
  await coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-456",
    run: async () => mockSnapshot
  });
  assert.equal(received.length, 1);
});

test("ScanCoordinator cancels superseded scans", async () => {
  const coordinator = new ScanCoordinator();
  let firstAborted = false;

  const firstScan = coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-1",
    run: (signal) =>
      new Promise<ModuleAnalysisSnapshot>((resolve, reject) => {
        signal.addEventListener("abort", () => {
          firstAborted = true;
          reject(new Error("Scan cancelled"));
        });
      })
  });

  // Start second scan for same module ID while first is pending
  const secondScan = coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-2",
    run: async () => mockSnapshot
  });

  await assert.rejects(firstScan, { message: "Scan cancelled" });
  const result = await secondScan;

  assert.ok(firstAborted);
  assert.deepEqual(result, mockSnapshot);
});

test("ScanCoordinator dispose aborts active scans", async () => {
  const coordinator = new ScanCoordinator();
  let aborted = false;

  const scan = coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-1",
    run: (signal) =>
      new Promise<ModuleAnalysisSnapshot>((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("Scan cancelled"));
        });
      })
  });

  coordinator.dispose();
  await assert.rejects(scan, { message: "Scan cancelled" });
  assert.ok(aborted);
});

test("ScanCoordinator stores and emits fallback failed snapshot on non-abort error", async () => {
  const coordinator = new ScanCoordinator();
  const emitted: ModuleAnalysisSnapshot[] = [];
  coordinator.events.onSnapshot((s) => emitted.push(s));

  const scanPromise = coordinator.scanModule({
    module: dummyModule,
    contentHash: "hash-err",
    run: async () => {
      throw new Error("go list command failed");
    }
  });

  await assert.rejects(scanPromise, { message: "go list command failed" });

  const snapshot = coordinator.getSnapshot("mod-1");
  assert.ok(snapshot);
  assert.equal(snapshot.updateState, "failed");
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.errors[0]?.message, "go list command failed");

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.updateState, "failed");
});

test("AnalysisCache stores and retrieves snapshots from disk", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-cache-"));
  try {
    const cache = new AnalysisCache(tmpDir);

    assert.equal(await cache.get("key-1"), undefined);

    await cache.set("key-1", mockSnapshot);
    const retrieved = await cache.get("key-1");
    assert.deepEqual(retrieved, mockSnapshot);

    await cache.delete("key-1");
    assert.equal(await cache.get("key-1"), undefined);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
