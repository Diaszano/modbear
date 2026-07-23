import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { StatusBarManager } from "../../providers/statusBarManager";

suite("StatusBarManager Test Suite", () => {
  const dummyModule: ModuleContext = {
    id: "mod-1",
    moduleRoot: "/path/to/mod",
    goModPath: "/path/to/mod/go.mod"
  };

  test("initializes status bar item with OK state when no modules/snapshots exist", () => {
    const coordinator = { getSnapshot: () => undefined } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    const item = manager.getStatusBarItem();

    assert.equal(item.command, "modBear.showStatusBarMenu");
    assert.equal(item.alignment, vscode.StatusBarAlignment.Right);
    assert.equal(item.priority, 100);
    assert.equal(item.text, "🐻 ModBear: OK");
    assert.ok(item.tooltip?.toString().includes("All Go modules analyzed"));

    manager.dispose();
  });

  test("shows scanning state when active scans exist", () => {
    const coordinator = { getSnapshot: () => undefined } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    const item = manager.getStatusBarItem();

    manager.markScanStarted("mod-1");
    assert.equal(item.text, "$(sync~spin) ModBear: Scanning...");
    assert.ok(item.tooltip?.toString().includes("scanning Go modules"));

    manager.markScanFinished("mod-1");
    assert.equal(item.text, "🐻 ModBear: OK");

    manager.dispose();
  });

  test("shows failed state when snapshot updateState is failed", () => {
    const failedSnapshot: ModuleAnalysisSnapshot = {
      moduleId: "mod-1",
      contentHash: "hash",
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "failed",
      dependencies: [],
      replacements: [],
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? failedSnapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "$(error) ModBear: Failed");
    assert.ok(item.tooltip?.toString().includes("Some module scans failed"));

    manager.dispose();
  });

  test("shows updates and warnings count with proper pluralization", () => {
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: "mod-1",
      contentHash: "hash",
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: [
        {
          modulePath: "example.com/dep1",
          installedVersion: "v1.0.0",
          availableVersion: "v1.1.0",
          retractionRationales: [],
          errors: []
        },
        {
          modulePath: "example.com/dep2",
          installedVersion: "v1.0.0",
          availableVersion: "v1.2.0",
          deprecatedMessage: "deprecated",
          retractionRationales: ["retracted rationale"],
          errors: []
        }
      ],
      replacements: [],
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "🐻 ModBear: 2 updates, 1 warning");
    assert.ok(item.tooltip?.toString().includes("Updates: 2"));
    assert.ok(item.tooltip?.toString().includes("Warnings: 1"));

    manager.dispose();
  });

  test("singular update count formatting", () => {
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: "mod-1",
      contentHash: "hash",
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: [
        {
          modulePath: "example.com/dep1",
          installedVersion: "v1.0.0",
          availableVersion: "v1.1.0",
          retractionRationales: [],
          errors: []
        }
      ],
      replacements: [],
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "🐻 ModBear: 1 update");

    manager.dispose();
  });
});
