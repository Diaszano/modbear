import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { DependencyCodeActionsProvider } from "../../providers/dependencyCodeActionsProvider";
import { GoModDocumentCache } from "../../parsers/goModDocumentCache";

const notRunToolchain = { state: "unavailable" as const, errors: [] };

suite("DependencyCodeActionsProvider", () => {
  test("offers validated detail, explanation, advisory, and tidy actions from the selected go.mod context", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire example.com/library v1.0.0\n"
    });
    const module: ModuleContext = {
      id: "/workspace/app",
      moduleRoot: "/workspace/app",
      goModPath: document.uri.fsPath
    };
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: module.id,
      contentHash: "fixture",
      createdAt: new Date(0).toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: [{
        modulePath: "example.com/library",
        installedVersion: "v1.0.0",
        retractionRationales: [],
        errors: []
      }],
      replacements: [],
      tidy: { state: "complete", consistent: false, diff: "diff --git a/go.mod b/go.mod", errors: [] },
      toolchain: notRunToolchain,
      vulnerabilities: {
        state: "complete",
        findings: [{
          osvId: "GO-2026-0001",
          classification: "reachable",
          fixedVersion: "v1.2.0",
          trace: [{ module: "example.com/library", version: "v1.0.0" }]
        }],
        advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical finding" } },
        errors: []
      },
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const provider = new DependencyCodeActionsProvider(coordinator, () => module, cache);

    const dependencyActions = await provider.provideCodeActions(document, new vscode.Range(2, 28, 2, 34));
    assert.deepEqual(dependencyActions.map((action) => action.command?.command).sort(), [
      "modBear.explainDependency",
      "modBear.openAdvisory",
      "modBear.showDetails"
    ]);
    assert.deepEqual(
      dependencyActions.find((action) => action.command?.command === "modBear.showDetails")?.command?.arguments,
      [{ modulePath: "example.com/library", osvId: "GO-2026-0001" }]
    );
    assert.deepEqual(
      dependencyActions.find((action) => action.command?.command === "modBear.openAdvisory")?.command?.arguments,
      [{ url: "https://osv.dev/vulnerability/GO-2026-0001" }]
    );

    const tidyActions = await provider.provideCodeActions(document, new vscode.Range(0, 7, 0, 22));
    assert.deepEqual(tidyActions.map((action) => action.command?.command), ["modBear.showTidyDiff"]);
    provider.dispose();
  });

  test("registers detail commands and refuses untrusted or invalid advisory invocations", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    if (extension && !extension.isActive) await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "modBear.showDetails",
      "modBear.explainDependency",
      "modBear.openAdvisory",
      "modBear.showTidyDiff"
    ]) assert.ok(commands.includes(command));

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalOpenExternal = vscode.env.openExternal;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    let externalCalls = 0;
    let warningCalls = 0;
    Object.defineProperty(vscode.env, "openExternal", {
      configurable: true,
      value: async () => { externalCalls += 1; return true; }
    });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      configurable: true,
      value: async () => { warningCalls += 1; return undefined; }
    });
    Object.defineProperty(vscode.window, "showErrorMessage", {
      configurable: true,
      value: async () => undefined
    });
    try {
      Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, get: () => false });
      await vscode.commands.executeCommand("modBear.openAdvisory", { url: "https://osv.dev/vulnerability/GO-2026-0001" });
      await vscode.commands.executeCommand("modBear.showDetails", { modulePath: "example.com/library", osvId: "GO-2026-0001" });
      await vscode.commands.executeCommand("modBear.explainDependency", { modulePath: "example.com/library" });
      await vscode.commands.executeCommand("modBear.showTidyDiff");
      assert.equal(warningCalls, 4);

      Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, get: () => true });
      await vscode.commands.executeCommand("modBear.openAdvisory", { url: "command:workbench.action.reloadWindow" });
      assert.equal(externalCalls, 0);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", { configurable: true, get: () => originalIsTrusted });
      Object.defineProperty(vscode.env, "openExternal", { configurable: true, value: originalOpenExternal });
      Object.defineProperty(vscode.window, "showWarningMessage", { configurable: true, value: originalShowWarningMessage });
      Object.defineProperty(vscode.window, "showErrorMessage", { configurable: true, value: originalShowErrorMessage });
    }
  });
});
