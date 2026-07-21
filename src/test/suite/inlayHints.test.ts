import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { DependencyInlayHintsProvider } from "../../providers/dependencyInlayHintsProvider";
import { DependencyHoverProvider } from "../../providers/dependencyHoverProvider";

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
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined);
    const hints = provider.provideInlayHints(document);
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.position.line, 2);
    assert.equal(hints[0]?.position.character, document.lineAt(2).text.length);
    assert.match(String(hints[0]?.label), /v1\.10\.1/);
    assert.equal(document.getText().includes("v1.10.1"), false);
    provider.dispose();
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
