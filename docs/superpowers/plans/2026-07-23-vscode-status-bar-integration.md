# VS Code Status Bar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a dynamic VS Code status bar item for the ModBear extension that displays scan states, updates/warnings counts, and triggers a Quick Pick actions menu on click.

**Architecture:** A `StatusBarManager` will manage the `vscode.StatusBarItem`, updating its visual state in response to lifecycle events and scans. Click interactions will execute a custom registered command `modBear.showStatusBarMenu`.

**Tech Stack:** TypeScript, VS Code Extensibility API, Node.js Test Runner, Mocha (for Extension tests).

## Global Constraints

- Keep codebase documentation and unrelated code intact.
- Create clickable file links for all modified files using standard GitHub-style markdown file links.
- Strictly adhere to naming prefix `modBear.*`.

---

### Task 1: Command & Menu Registration in `package.json`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: None
- Produces: Command definition for `modBear.showStatusBarMenu`

- [ ] **Step 1: Modify `package.json` to register the new command**

  Add the command `modBear.showStatusBarMenu` to the `contributes.commands` array:
  ```json
        {
          "command": "modBear.showStatusBarMenu",
          "title": "ModBear: Show Status Bar Menu"
        }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add package.json
  git commit -m "feat: register modBear.showStatusBarMenu command in package.json"
  ```

---

### Task 2: Implement `StatusBarManager` Class

**Files:**
- Create: `src/providers/statusBarManager.ts`

**Interfaces:**
- Consumes: `ScanCoordinator` and `ModuleContext` types.
- Produces: `StatusBarManager` class with lifecycle management for status bar item.

- [ ] **Step 1: Create `src/providers/statusBarManager.ts` with complete implementation**

  Create [statusBarManager.ts](file:///home/diaszano/Documentos/Github/modbear/src/providers/statusBarManager.ts):
  ```typescript
  import * as vscode from "vscode";
  import type { ScanCoordinator } from "../orchestration/scanCoordinator";
  import type { ModuleContext } from "../domain/module";

  export class StatusBarManager implements vscode.Disposable {
    private readonly statusBarItem: vscode.StatusBarItem;
    private readonly coordinator: ScanCoordinator;
    private readonly activeScans = new Set<string>();
    private modules: readonly ModuleContext[] = [];

    constructor(coordinator: ScanCoordinator) {
      this.coordinator = coordinator;
      this.statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
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

    public getStatusBarItem(): vscode.StatusBarItem {
      return this.statusBarItem;
    }

    public dispose(): void {
      this.statusBarItem.dispose();
    }
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/providers/statusBarManager.ts
  git commit -m "feat: implement StatusBarManager class"
  ```

---

### Task 3: Hook `StatusBarManager` into `extension.ts` & Register Quick Pick Menu Command

**Files:**
- Modify: `src/extension.ts`

**Interfaces:**
- Consumes: `StatusBarManager` from `src/providers/statusBarManager.ts`
- Produces: Registration of `modBear.showStatusBarMenu` command, status bar lifecycle events hooks.

- [ ] **Step 1: Add imports and update `activate` method in `src/extension.ts`**

  Import `StatusBarManager` and wire it up:
  - Inside `activate`, instantiate `StatusBarManager`.
  - Pass the newly discovered modules to `statusBarManager.setModules(modules)`.
  - Listen to snapshot changes via the coordinator's snapshot events and call `statusBarManager.markScanFinished(snapshot.moduleId)`.
  - Inside `requestScan`, call `statusBarManager.markScanStarted(module.id)`. Also handle errors and call `statusBarManager.markScanFinished(module.id)`.
  - Register the `modBear.showStatusBarMenu` command.

  Let's define the command details:
  ```typescript
  import { StatusBarManager } from "./providers/statusBarManager";
  ```

  Inside `activate`:
  ```typescript
  const statusBarManager = new StatusBarManager(coordinator);
  context.subscriptions.push(statusBarManager);
  ```

  Hooking module discovery:
  ```typescript
  if (vscode.workspace.isTrusted) {
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    discoverModules(roots, new AbortController().signal).then(m => {
      modules = m;
      statusBarManager.setModules(m);
    });
  }
  ```

  Hooking scanner events:
  ```typescript
  coordinator.events.onSnapshot((snapshot) => {
    statusBarManager.markScanFinished(snapshot.moduleId);
    ...
  });
  ```

  In `requestScan`:
  ```typescript
  const requestScan = async (module: ModuleContext) => {
    const config = getConfig();
    let goPath = config.goPath;
    statusBarManager.markScanStarted(module.id);
    try {
      goPath = await resolveTool(config.goPath, "go");
    } catch (err) {
      statusBarManager.markScanFinished(module.id);
      vscode.window.showWarningMessage(`ModBear: Could not resolve go executable (${config.goPath}): ${err instanceof Error ? err.message : err}`);
      return;
    }
    const scanner = new ModuleScanner(cache, goPath, config.timeoutSeconds * 1000, config.updateTtlMinutes * 60000, output);
    coordinator.scanModule({
      module,
      contentHash: "",
      run: (signal) => scanner.scan(module, signal)
    }).catch(err => {
      statusBarManager.markScanFinished(module.id);
      output.error(`Scan failed for ${module.id}: ${err}`);
    });
  };
  ```

  And inside commands:
  ```typescript
  vscode.commands.registerCommand("modBear.showStatusBarMenu", async () => {
    const items = [
      {
        label: "$(sync) Scan Workspace",
        description: "Force scan all Go modules in the workspace",
        action: () => vscode.commands.executeCommand("modBear.scanWorkspace")
      },
      {
        label: "$(output) Show Output Logs",
        description: "Open ModBear's output channel to view logs",
        action: () => vscode.commands.executeCommand("modBear.showOutput")
      }
    ];

    // Dynamic section for modules
    for (const module of modules) {
      const snap = coordinator.getSnapshot(module.id);
      let detail = "Scan pending...";
      if (snap) {
        if (snap.updateState === "failed") {
          detail = "Scan failed";
        } else {
          const updates = snap.dependencies.filter(d => d.availableVersion).length;
          const warnings = snap.dependencies.filter(d => d.deprecatedMessage || d.retractionRationales.length > 0 || d.errors.length > 0).length;
          detail = updates === 0 && warnings === 0 ? "Up to date" : `${updates} updates, ${warnings} warnings`;
        }
      }
      items.push({
        label: `$(file-code) ${module.id}`,
        description: detail,
        action: async () => {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(module.goModPath));
          await vscode.window.showTextDocument(doc);
        }
      });
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: "ModBear: Go Dependency Insights",
      placeHolder: "Select an action or module"
    });

    if (selected) {
      await selected.action();
    }
  })
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/extension.ts
  git commit -m "feat: integrate StatusBarManager and register showStatusBarMenu command"
  ```

---

### Task 4: Extension Integration Tests

**Files:**
- Create: `src/test/suite/statusBarManager.test.ts`

**Interfaces:**
- Consumes: `StatusBarManager`, `ScanCoordinator`
- Produces: Test verification for status bar behaviors.

- [ ] **Step 1: Create `src/test/suite/statusBarManager.test.ts`**

  Create [statusBarManager.test.ts](file:///home/diaszano/Documentos/Github/modbear/src/test/suite/statusBarManager.test.ts):
  ```typescript
  import assert from "node:assert/strict";
  import * as vscode from "vscode";
  import { StatusBarManager } from "../../providers/statusBarManager";
  import { ScanCoordinator } from "../../orchestration/scanCoordinator";
  import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
  import type { ModuleContext } from "../../domain/module";

  suite("StatusBarManager Extension Host Tests", () => {
    test("initializes correctly and updates states", async () => {
      const coordinator = new ScanCoordinator();
      const manager = new StatusBarManager(coordinator);
      
      const item = manager.getStatusBarItem();
      assert.ok(item);
      assert.equal(item.command, "modBear.showStatusBarMenu");
      
      // Default state with no modules
      assert.equal(item.text, "🐻 ModBear: OK");
      assert.match(item.tooltip as string, /All Go modules analyzed/);

      // Scanning state
      manager.markScanStarted("mod-1");
      assert.equal(item.text, "$(sync~spin) ModBear: Scanning...");
      assert.match(item.tooltip as string, /scanning Go modules/);

      manager.markScanFinished("mod-1");
      assert.equal(item.text, "🐻 ModBear: OK");

      // Updates / warnings state
      const module: ModuleContext = {
        id: "mod-1",
        moduleRoot: "/workspace/mod-1",
        goModPath: "/workspace/mod-1/go.mod"
      };
      
      const mockSnapshot: ModuleAnalysisSnapshot = {
        moduleId: "mod-1",
        contentHash: "fixture",
        createdAt: new Date().toISOString(),
        stale: false,
        updateState: "complete",
        dependencies: [
          {
            modulePath: "github.com/foo/bar",
            installedVersion: "v1.0.0",
            availableVersion: "v1.1.0",
            retractionRationales: [],
            errors: []
          }
        ],
        replacements: [],
        errors: []
      };

      // Mock coordinator getSnapshot
      coordinator.getSnapshot = (id) => id === "mod-1" ? mockSnapshot : undefined;
      
      manager.setModules([module]);
      assert.equal(item.text, "🐻 ModBear: 1 update");
      assert.match(item.tooltip as string, /Updates: 1/);

      manager.dispose();
    });
  });
  ```

- [ ] **Step 2: Run extension tests to verify implementation**

  Run command:
  ```bash
  npm run compile && npm run bundle && node out/test/runExtensionTests.js
  ```
  Expected: All extension tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/test/suite/statusBarManager.test.ts
  git commit -m "test: add suite tests for StatusBarManager"
  ```
