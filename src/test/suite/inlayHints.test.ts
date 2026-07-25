import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import type { ScanCoordinator } from "../../orchestration/scanCoordinator";
import { DependencyInlayHintsProvider } from "../../providers/dependencyInlayHintsProvider";
import { DependencyHoverProvider } from "../../providers/dependencyHoverProvider";
import { GoModDocumentCache } from "../../parsers/goModDocumentCache";

const notRunVulnerabilities = { state: "not-run" as const, findings: [], advisories: {}, errors: [] };
const notRunTidy = { state: "idle" as const, consistent: false, errors: [] };
const notRunToolchain = { state: "unavailable" as const, errors: [] };

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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);
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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);

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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);
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
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const hoverProvider = new DependencyHoverProvider(coordinator, () => module, cache);

    const versionIndex = document.lineAt(2).text.indexOf("v1.9.1");
    const hover = hoverProvider.provideHover(document, new vscode.Position(2, versionIndex + 1));
    assert.ok(hover);
    const markdown = hover.contents[0] as vscode.MarkdownString;
    assert.equal(markdown.isTrusted, false);
    assert.ok(markdown.value.includes("github.com/gin-gonic/gin"));
    assert.ok(markdown.value.includes("v1.10.1"));
    assert.ok(markdown.value.includes("go get github.com/gin-gonic/gin@v1.10.1"));
  });

  test("provides hover text indicating vulnerability analysis is unavailable", async () => {
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
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const hoverProvider = new DependencyHoverProvider(coordinator, () => module, cache);

    const versionIndex = document.lineAt(2).text.indexOf("v1.9.1");
    const hover = hoverProvider.provideHover(document, new vscode.Position(2, versionIndex + 1));
    assert.ok(hover);
    const markdown = hover.contents[0] as vscode.MarkdownString;
    assert.ok(markdown.value.includes("Vulnerability analysis unavailable"));
  });

  test("provides hover showing vulnerability details when analysis is complete", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n"
    });
    const module: ModuleContext = {
      id: "/workspace/app",
      moduleRoot: "/workspace/app",
      goModPath: document.uri.fsPath
    };
    const advisories = {
      "GO-2026-0001": { id: "GO-2026-0001", summary: "Some critical vulnerability details" }
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
            fixedVersion: "v1.10.0",
            classification: "reachable",
            trace: [{ module: "github.com/gin-gonic/gin", version: "v1.9.1" }]
          }
        ],
        advisories,
        errors: []
      },
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const hoverProvider = new DependencyHoverProvider(coordinator, () => module, cache);

    const versionIndex = document.lineAt(2).text.indexOf("v1.9.1");
    const hover = hoverProvider.provideHover(document, new vscode.Position(2, versionIndex + 1));
    assert.ok(hover);
    const markdown = hover.contents[0] as vscode.MarkdownString;
    assert.ok(markdown.value.includes("GO-2026-0001"));
    assert.ok(markdown.value.includes("reachable"));
    assert.ok(markdown.value.includes("Some critical vulnerability details"));
    assert.ok(markdown.value.includes("Fixed in: `v1.10.0`"));
  });

  test("prioritizes a reachable vulnerability in the inlay while preserving update and lifecycle hover details", async () => {
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
        availableVersion: "v2.0.0",
        updateKind: "major",
        deprecatedMessage: "use the maintained fork",
        retractionRationales: ["bad release"],
        errors: []
      }],
      replacements: [],
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: {
        state: "complete",
        findings: [{
          osvId: "GO-2026-0001",
          fixedVersion: "v2.0.1",
          classification: "reachable",
          trace: [{ module: "github.com/gin-gonic/gin", version: "v1.9.1" }]
        }],
        advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical finding" } },
        errors: []
      },
      errors: []
    };
    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const inlayProvider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);
    const hoverProvider = new DependencyHoverProvider(coordinator, () => module, cache);

    const hints = inlayProvider.provideInlayHints(document);
    const label = hints[0]?.label;
    assert.ok(Array.isArray(label));
    assert.equal(label[1]?.value, " 🛡 fixed in v2.0.1");

    const versionIndex = document.lineAt(2).text.indexOf("v1.9.1");
    const hover = hoverProvider.provideHover(document, new vscode.Position(2, versionIndex + 1));
    assert.ok(hover);
    const markdown = hover.contents[0] as vscode.MarkdownString;
    assert.match(markdown.value, /Available: `v2.0.0`/);
    assert.match(markdown.value, /Deprecated:/);
    assert.match(markdown.value, /Retracted:/);
    assert.match(markdown.value, /GO-2026-0001/);

    inlayProvider.dispose();
  });

  test("returns empty inlay hints when modBear.enabled is false", async () => {
    const config = vscode.workspace.getConfiguration("modBear");
    const originalEnabled = config.get("enabled");
    await config.update("enabled", false, vscode.ConfigurationTarget.Global);

    try {
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
        tidy: notRunTidy,
        toolchain: notRunToolchain,
        vulnerabilities: notRunVulnerabilities,
        errors: []
      };
      const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
      const cache = new GoModDocumentCache();
      const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);

      const hints = provider.provideInlayHints(document);
      assert.equal(hints.length, 0, "No inlay hints should be returned when extension is disabled");
      provider.dispose();
    } finally {
      await config.update("enabled", originalEnabled, vscode.ConfigurationTarget.Global);
    }
  });

  test("uses O(N) map lookup complexity rather than O(N^2) scan", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "go.mod",
      content: [
        "module example.com/app",
        "",
        ...Array.from({ length: 100 }, (_, i) => `require example.com/mod-${i} v1.0.${i}`)
      ].join("\n")
    });

    const module: ModuleContext = {
      id: "/workspace/app",
      moduleRoot: "/workspace/app",
      goModPath: document.uri.fsPath
    };

    let findCalls = 0;
    let mapCalls = 0;

    const rawDeps = Array.from({ length: 100 }, (_, i) => ({
      modulePath: `example.com/mod-${i}`,
      installedVersion: `v1.0.${i}`,
      availableVersion: `v1.0.${i + 1}`,
      updateKind: "minor" as const,
      retractionRationales: [],
      errors: []
    }));

    const dependenciesProxy = new Proxy(rawDeps, {
      get(target, prop, receiver) {
        if (prop === "find") {
          findCalls++;
        }
        if (prop === "map") {
          mapCalls++;
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: module.id,
      contentHash: "fixture",
      createdAt: new Date(0).toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: dependenciesProxy,
      replacements: [],
      tidy: notRunTidy,
      toolchain: notRunToolchain,
      vulnerabilities: notRunVulnerabilities,
      errors: []
    };

    const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
    const cache = new GoModDocumentCache();
    const provider = new DependencyInlayHintsProvider(coordinator, () => module, () => undefined, cache);

    const hints = provider.provideInlayHints(document);
    assert.equal(hints.length, 100);
    assert.equal(findCalls, 0, "Should not use .find in a loop");
    assert.equal(mapCalls, 1, "Should construct Map exactly once");
    provider.dispose();
  });
});
