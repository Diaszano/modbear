# VS Code Status Bar Integration — Specification

> **Status:** Draft (Pending User Approval)  
> **Date:** 2026-07-23  
> **Product name:** ModBear  
> **Feature:** VS Code Status Bar Integration  

## 1. Executive Summary

This specification outlines the integration of a VS Code status bar item for the ModBear extension. The status bar item will provide real-time updates on active dependency scans, report health status, and display the total number of outdated modules or warnings. Clicking the status bar item will trigger an interactive Quick Pick menu.

---

## 2. Architecture & Design

### 2.1 The `StatusBarManager`

We will introduce a class [StatusBarManager](file:///home/diaszano/Documentos/Github/modbear/src/providers/statusBarManager.ts) located in `src/providers/statusBarManager.ts` (or `src/statusBar/statusBarManager.ts`).

This class implements `vscode.Disposable` to cleanly clean up resources upon extension deactivation.

```typescript
import * as vscode from "vscode";
import { ScanCoordinator } from "../orchestration/scanCoordinator";
import { ModuleContext } from "../domain/module";

export class StatusBarManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly coordinator: ScanCoordinator;
  private readonly activeScans = new Set<string>();
  private modules: readonly ModuleContext[] = [];

  constructor(coordinator: ScanCoordinator) {
    this.coordinator = coordinator;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100 // Medium-priority right alignment
    );
    this.statusBarItem.command = "modBear.showStatusBarMenu";
    this.statusBarItem.show();
    
    this.update();
  }

  public setModules(modules: readonly ModuleContext[]): void {
    this.modules = modules;
    this.update();
  }

  public markScanStarted(moduleId: string): void {
    this.activeScans.add(moduleId);
    this.update();
  }

  public markScanFinished(moduleId: string): void {
    this.activeScans.delete(moduleId);
    this.update();
  }

  public update(): void {
    if (this.activeScans.size > 0) {
      this.statusBarItem.text = "$(sync~spin) ModBear: Scanning...";
      this.statusBarItem.tooltip = "ModBear is scanning Go modules for updates and vulnerabilities...";
      return;
    }

    let totalUpdates = 0;
    let totalWarnings = 0;
    let hasErrors = false;

    for (const module of this.modules) {
      const snapshot = this.coordinator.getSnapshot(module.id);
      if (!snapshot) continue;

      if (snapshot.updateState === "failed") {
        hasErrors = true;
      }

      for (const dep of snapshot.dependencies) {
        if (dep.availableVersion) {
          totalUpdates++;
        }
        if (dep.deprecatedMessage || dep.retractionRationales.length > 0 || dep.errors.length > 0) {
          totalWarnings++;
        }
      }
    }

    if (hasErrors) {
      this.statusBarItem.text = "$(error) ModBear: Failed";
      this.statusBarItem.tooltip = "Some module scans failed. Click to open logs.";
    } else if (totalUpdates > 0 || totalWarnings > 0) {
      const parts: string[] = [];
      if (totalUpdates > 0) parts.push(`${totalUpdates} update${totalUpdates > 1 ? "s" : ""}`);
      if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}`);
      
      this.statusBarItem.text = `🐻 ModBear: ${parts.join(", ")}`;
      this.statusBarItem.tooltip = `ModBear dependency analysis completed.\n- Updates: ${totalUpdates}\n- Warnings: ${totalWarnings}\n\nClick for actions.`;
    } else {
      this.statusBarItem.text = "🐻 ModBear: OK";
      this.statusBarItem.tooltip = "All Go modules analyzed. Dependencies are up to date.\nClick for actions.";
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
```

---

## 3. Interaction & Commands

### 3.1 Command `modBear.showStatusBarMenu`

When the user clicks the status bar item, it executes `modBear.showStatusBarMenu`. This command prompts a VS Code Quick Pick menu with the following choices:

* **Header/Title:** `ModBear: Go Dependency Insights`
* **Options:**
  1. `$(sync) Scan Workspace`
     * Description: `Force scan all Go modules in the workspace`
     * Action: Invokes `modBear.scanWorkspace`
  2. `$(output) Show Output Logs`
     * Description: `Open ModBear's output channel to view logs`
     * Action: Invokes `modBear.showOutput`
  3. *(Dynamic Section)* List of modules in the workspace:
     * Label: `$(file-code) go.mod (module-path)`
     * Detail: Status details of each module (e.g., `OK` or `3 updates, 1 warning` or `Scan pending...`).
     * Action: Opens the corresponding `go.mod` file in the active editor.

---

## 4. Integration Details in `extension.ts`

1. **Instantiation:** Instantiated inside the `activate` function:
   ```typescript
   const statusBarManager = new StatusBarManager(coordinator);
   context.subscriptions.push(statusBarManager);
   ```
2. **Module List Updates:** In `activate`, once `discoverModules` completes, invoke `statusBarManager.setModules(modules)`.
3. **Scan Start/End Hooks:**
   We can add listeners or intercept scan scheduling:
   - When a scan is scheduled inside `requestScan`, we invoke `statusBarManager.markScanStarted(module.id)`.
   - On coordinator `events.onSnapshot` event, we invoke `statusBarManager.markScanFinished(snapshot.moduleId)`.
   - On scan rejection/failure inside the coordinator, we also invoke `statusBarManager.markScanFinished`.

---

## 5. Verification & Testing Plan

### 5.1 Unit Tests
* Verify status bar item instantiation and alignment.
* Verify text and tooltip updates for various states:
  * Scanning (active scans > 0).
  * Error state (hasErrors = true).
  * Outdated modules.
  * Clean state (no updates, no warnings).

### 5.2 Integration Tests
* Verify command registration for `modBear.showStatusBarMenu`.
* Verify clicking status bar launches `vscode.window.showQuickPick`.
