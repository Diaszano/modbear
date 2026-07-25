import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

async function loadScanScheduler(): Promise<any> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        workspace: {
          isTrusted: true,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const ext = await import("../../extension.js");
    return ext.ScanScheduler;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("ScanScheduler schedules modules a and b independently within 500ms and both run once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ScanScheduler = await loadScanScheduler();

  const runs: string[] = [];
  const scheduler = new ScanScheduler((mod: any) => {
    runs.push(mod.id);
  });

  const config = { enabled: true, onSave: true, onOpen: true };
  const modA = { id: "module-a" };
  const modB = { id: "module-b" };

  scheduler.triggerScan(modA, false, config);
  scheduler.triggerScan(modB, false, config);

  t.mock.timers.tick(499);
  assert.equal(runs.length, 0);

  t.mock.timers.tick(1);
  assert.deepEqual(runs.sort(), ["module-a", "module-b"]);

  scheduler.dispose();
});

test("ScanScheduler replaces the timer for the same module when scheduled twice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ScanScheduler = await loadScanScheduler();

  const runs: string[] = [];
  const scheduler = new ScanScheduler((mod: any) => {
    runs.push(mod.id);
  });

  const config = { enabled: true, onSave: true, onOpen: true };
  const modA = { id: "module-a" };

  scheduler.triggerScan(modA, false, config);
  t.mock.timers.tick(250);

  // Trigger again
  scheduler.triggerScan(modA, false, config);
  t.mock.timers.tick(250);

  // Since it was reset at 250ms, a total of 500ms from the first call has elapsed, but it has only been 250ms from the second call.
  // So it shouldn't have run yet.
  assert.equal(runs.length, 0);

  t.mock.timers.tick(250);
  assert.deepEqual(runs, ["module-a"]);

  scheduler.dispose();
});

test("ScanScheduler does not trigger scan if modBear.enabled is false", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ScanScheduler = await loadScanScheduler();

  const runs: string[] = [];
  const scheduler = new ScanScheduler((mod: any) => {
    runs.push(mod.id);
  });

  const config = { enabled: false, onSave: true, onOpen: true };
  const modA = { id: "module-a" };

  scheduler.triggerScan(modA, false, config);
  t.mock.timers.tick(500);

  assert.equal(runs.length, 0);
  scheduler.dispose();
});
