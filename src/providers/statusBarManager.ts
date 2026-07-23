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
