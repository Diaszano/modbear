import * as vscode from "vscode";
import type { ScanCoordinator } from "../orchestration/scanCoordinator";
import type { ModuleContext } from "../domain/module";
import { getSnapshotMetrics } from "../domain/analysis";

export class StatusBarManager implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly coordinator: ScanCoordinator;
  private activeScansCount = 0;
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

  public markScanStarted(_moduleId?: string): void {
    this.activeScansCount++;
    this.update();
  }

  public markScanFinished(_moduleId?: string): void {
    this.activeScansCount = Math.max(0, this.activeScansCount - 1);
    this.update();
  }

  public update(): void {
    if (this.activeScansCount > 0) {
      this.statusBarItem.text = "$(sync~spin) ModBear: Scanning...";
      const tooltip = new vscode.MarkdownString("ModBear is scanning Go modules for updates, deprecations, and retractions...", true);
      tooltip.isTrusted = true;
      this.statusBarItem.tooltip = tooltip;
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

      const { updates, warnings } = getSnapshotMetrics(snapshot);
      totalUpdates += updates;
      totalWarnings += warnings;
    }

    if (hasErrors) {
      this.statusBarItem.text = "$(error) ModBear: Failed";
      const tooltip = new vscode.MarkdownString("Some module scans failed. Click to open logs.", true);
      tooltip.isTrusted = true;
      this.statusBarItem.tooltip = tooltip;
    } else if (totalUpdates > 0 || totalWarnings > 0) {
      const parts: string[] = [];
      if (totalUpdates > 0) parts.push(`${totalUpdates} update${totalUpdates > 1 ? "s" : ""}`);
      if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}`);

      this.statusBarItem.text = `🐻 ModBear: ${parts.join(", ")}`;
      const tooltip = new vscode.MarkdownString(
        `ModBear dependency analysis completed.\n- Updates: ${totalUpdates}\n- Warnings: ${totalWarnings}\n\nClick for actions.`,
        true
      );
      tooltip.isTrusted = true;
      this.statusBarItem.tooltip = tooltip;
    } else {
      this.statusBarItem.text = "🐻 ModBear: OK";
      const tooltip = new vscode.MarkdownString(
        "All Go modules analyzed. Dependencies are up to date.\nClick for actions.",
        true
      );
      tooltip.isTrusted = true;
      this.statusBarItem.tooltip = tooltip;
    }
  }

  public getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
