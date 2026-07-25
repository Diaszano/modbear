import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { StatusBarManager } from "../../providers/statusBarManager";

const notRunVulnerabilities = { state: "not-run" as const, findings: [], advisories: {}, errors: [] };
const notRunTidy = { state: "idle" as const, consistent: false, errors: [] };
const notRunToolchain = { state: "unavailable" as const, errors: [] };

function getTooltipText(tooltip: string | vscode.MarkdownString | undefined): string {
  if (!tooltip) return "";
  if (typeof tooltip === "string") return tooltip;
  return tooltip.value ?? String(tooltip);
}

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
    assert.ok(item.tooltip instanceof vscode.MarkdownString);
    assert.equal((item.tooltip as vscode.MarkdownString).isTrusted, true);
    assert.ok(getTooltipText(item.tooltip).includes("All Go modules analyzed"));

    manager.dispose();
  });

  test("shows scanning state when active scans exist and handles concurrent scan counts", () => {
    const coordinator = { getSnapshot: () => undefined } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    const item = manager.getStatusBarItem();

    manager.markScanStarted("mod-1");
    assert.equal(item.text, "$(sync~spin) ModBear: Scanning...");
    assert.ok(getTooltipText(item.tooltip).includes("scanning Go modules"));

    // Concurrent scan started for another or same module
    manager.markScanStarted("mod-1");
    assert.equal(item.text, "$(sync~spin) ModBear: Scanning...");

    // First scan finished -> still scanning because count > 0
    manager.markScanFinished("mod-1");
    assert.equal(item.text, "$(sync~spin) ModBear: Scanning...");

    // Second scan finished -> now OK
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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? failedSnapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "$(error) ModBear: Failed");
    assert.ok(getTooltipText(item.tooltip).includes("Some module scans failed"));

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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "🐻 ModBear: 2 updates, 1 warning");
    assert.ok(getTooltipText(item.tooltip).includes("Updates: 2"));
    assert.ok(getTooltipText(item.tooltip).includes("Warnings: 1"));

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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "🐻 ModBear: 1 update");

    manager.dispose();
  });

  test("shows vulnerability analysis unavailable when vulnerabilities state is unavailable", () => {
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: "mod-1",
      contentHash: "hash",
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: [],
      replacements: [],
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: {
        state: "unavailable",
        findings: [],
        advisories: {},
        errors: [{ code: "tool-not-found", message: "Vulnerability analysis is unavailable." }]
      },
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "$(question) ModBear: Vulnerability analysis unavailable");

    manager.dispose();
  });

  test("shows vulnerability count alongside updates and warnings", () => {
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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: {
        state: "complete",
        findings: [
          {
            osvId: "GO-2026-0001",
            fixedVersion: "v1.2.3",
            classification: "reachable",
            trace: [{ module: "example.com/dep1", version: "v1.0.0" }]
          }
        ],
        advisories: {},
        errors: []
      },
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    assert.equal(item.text, "🐻 ModBear: 1 update, 1 vulnerability");
    assert.ok(getTooltipText(item.tooltip).includes("Vulnerabilities: 1"));

    manager.dispose();
  });

  test("shows updates and warnings but appends vulnerability analysis unavailable to tooltip when scanner is unavailable", () => {
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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: {
        state: "unavailable",
        findings: [],
        advisories: {},
        errors: [{ code: "tool-not-found", message: "Vulnerability analysis is unavailable." }]
      },
      errors: []
    };

    const coordinator = { getSnapshot: (id: string) => (id === "mod-1" ? snapshot : undefined) } as unknown as ScanCoordinator;
    const manager = new StatusBarManager(coordinator);
    manager.setModules([dummyModule]);

    const item = manager.getStatusBarItem();
    // Should prioritize showing updates (text should indicate update)
    assert.equal(item.text, "🐻 ModBear: 1 update");
    
    // Tooltip should contain both the updates and the vulnerability analysis unavailable note
    const tooltipText = getTooltipText(item.tooltip);
    assert.ok(tooltipText.includes("Updates: 1"));
    assert.ok(tooltipText.includes("- Vulnerability analysis: Unavailable"));

    manager.dispose();
  });
});
