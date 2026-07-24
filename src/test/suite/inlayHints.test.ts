import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { DependencyInlayHintsProvider } from "../../providers/dependencyInlayHintsProvider";
import { DependencyHoverProvider } from "../../providers/dependencyHoverProvider";

const notRunVulnerabilities = { state: "not-run" as const, findings: [], errors: [] };

suite("DependencyInlayHintsProvider & DependencyHoverProvider", () => {
  test("places the available version immediately after the installed version", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n"
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
      dependencies: [
        {
          modulePath: "github.com/gin-gonic/gin",
          installedVersion: "v1.9.1",
          availableVersion: "v1.10.1",
          updateKind: "minor",
          retractionRationales: [],
          errors: []
        }
      ],
      replacements: [],
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined);
    const hints = provider.provideInlayHints(document);
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.position.line, 2);
    assert.equal(hints[0]?.position.character, document.lineAt(2).text.length);
    const label = hints[0]?.label;
    assert.ok(Array.isArray(label));
    assert.equal(label[0]?.value, "$(terminal)");
    assert.equal(label[0]?.command?.command, "modBear.prepareUpdateInTerminal");
    assert.deepEqual(label[0]?.command?.arguments, [{
      moduleRoot: module.moduleRoot,
      modulePath: "github.com/gin-gonic/gin",
      version: "v1.10.1"
    }]);
    assert.equal(label[1]?.value, " → v1.10.1 · minor");
    assert.equal(label[1]?.command, undefined);
    assert.equal(document.getText().includes("v1.10.1"), false);
    provider.dispose();
  });

  test("does not add the terminal action without an available version", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire example.com/old v1.0.0\n"
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
        modulePath: "example.com/old",
        installedVersion: "v1.0.0",
        deprecatedMessage: "use example.com/new",
        retractionRationales: [],
        errors: []
      }],
      replacements: [],
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined);

    const hints = provider.provideInlayHints(document);

    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.label, "⚠ deprecated");
    provider.dispose();
  });

  test("does not add the terminal action in an untrusted workspace", async () => {
    const originalIsTrusted = vscode.workspace.isTrusted;
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n"
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
        modulePath: "github.com/gin-gonic/gin",
        installedVersion: "v1.9.1",
        availableVersion: "v1.10.1",
        updateKind: "minor",
        retractionRationales: [],
        errors: []
      }],
      replacements: [],
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined);
    Object.defineProperty(vscode.workspace, "isTrusted", {
      configurable: true,
      get: () => false
    });

    try {
      const hints = provider.provideInlayHints(document);
      assert.equal(hints.length, 1);
      assert.equal(hints[0]?.label, "→ v1.10.1 · minor");
    } finally {
      provider.dispose();
      Object.defineProperty(vscode.workspace, "isTrusted", {
        configurable: true,
        get: () => originalIsTrusted
      });
    }
  });

  test("provides hover detail without markdown command execution risks", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n"
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
      dependencies: [
        {
          modulePath: "github.com/gin-gonic/gin",
          installedVersion: "v1.9.1",
          availableVersion: "v1.10.1",
          updateKind: "minor",
          retractionRationales: [],
          errors: []
        }
      ],
      replacements: [],
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const hoverProvider = new DependencyHoverProvider(coordinator, () => module);

    const versionIndex = document.lineAt(2).text.indexOf("v1.9.1");
    const hover = hoverProvider.provideHover(document, new vscode.Position(2, versionIndex + 1));
    assert.ok(hover);
    const markdown = hover.contents[0] as vscode.MarkdownString;
    assert.equal(markdown.isTrusted, false);
    assert.ok(markdown.value.includes("github.com/gin-gonic/gin"));
    assert.ok(markdown.value.includes("v1.10.1"));
    assert.ok(markdown.value.includes("go get github.com/gin-gonic/gin@v1.10.1"));
  });
});
