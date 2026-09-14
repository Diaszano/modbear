import assert from "node:assert/strict";
import * as vscode from "vscode";
import type { DependencyStatus, ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ModuleContext } from "../../domain/module";
import { DetailsDocumentProvider } from "../../providers/detailsDocumentProvider";
import {
  createExplainDependencyHandler,
  createOpenAdvisoryHandler,
  createShowDetailsHandler,
  createShowTidyDiffHandler,
  NO_ADVISORY_INFO,
  NO_SNAPSHOT_INFO,
  NO_TIDY_ANALYSIS_INFO,
  NO_TIDY_DIFF_INFO,
  TRUST_WARNING,
  type DetailCommandContext,
  type ExplainRunner,
} from "../../commands/detailsCommands";

const moduleContext: ModuleContext = {
  id: "/workspace/app",
  moduleRoot: "/workspace/app",
  goModPath: "/workspace/app/go.mod",
};

function dependency(overrides: Partial<DependencyStatus> = {}): DependencyStatus {
  return {
    modulePath: "example.com/library",
    installedVersion: "v1.0.0",
    availableVersion: "v1.1.0",
    updateKind: "minor",
    retractionRationales: [],
    errors: [],
    ...overrides,
  };
}

function snapshot(overrides: Partial<ModuleAnalysisSnapshot> = {}): ModuleAnalysisSnapshot {
  return {
    moduleId: moduleContext.id,
    contentHash: "fixture",
    createdAt: new Date(0).toISOString(),
    stale: false,
    updateState: "complete",
    dependencies: [dependency()],
    replacements: [],
    vulnerabilities: { state: "not-run", findings: [], advisories: {}, errors: [] },
    errors: [],
    ...overrides,
  };
}

function stub(target: object, key: string | symbol, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else Object.defineProperty(target, key, { value: undefined, configurable: true, writable: true });
  };
}

interface StubbedEnvironment {
  readonly infos: string[];
  readonly warnings: string[];
  readonly errors: string[];
  readonly openedUris: vscode.Uri[];
  readonly shownDocuments: vscode.TextDocument[];
  readonly externalUris: vscode.Uri[];
  readonly restore: () => void;
}

function stubEnvironment(pickedQuickPickItem: unknown): StubbedEnvironment {
  const infos: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const openedUris: vscode.Uri[] = [];
  const shownDocuments: vscode.TextDocument[] = [];
  const externalUris: vscode.Uri[] = [];

  const restores = [
    stub(vscode.window, "showInformationMessage", async (message: string) => {
      infos.push(message);
      return undefined;
    }),
    stub(vscode.window, "showWarningMessage", async (message: string) => {
      warnings.push(message);
      return undefined;
    }),
    stub(vscode.window, "showErrorMessage", async (message: string) => {
      errors.push(message);
      return undefined;
    }),
    stub(vscode.window, "showQuickPick", async () => pickedQuickPickItem),
    stub(vscode.workspace, "openTextDocument", async (uri: vscode.Uri) => {
      openedUris.push(uri);
      return { uri } as vscode.TextDocument;
    }),
    stub(vscode.window, "showTextDocument", async (document: vscode.TextDocument) => {
      shownDocuments.push(document);
      return undefined as unknown as vscode.TextEditor;
    }),
    stub(vscode.env, "openExternal", async (uri: vscode.Uri) => {
      externalUris.push(uri);
      return true;
    }),
  ];

  return {
    infos,
    warnings,
    errors,
    openedUris,
    shownDocuments,
    externalUris,
    restore: () => {
      for (const restore of restores) restore();
    },
  };
}

suite("ModBear detail commands", () => {
  let provider: DetailsDocumentProvider;

  setup(() => {
    provider = new DetailsDocumentProvider();
  });

  teardown(() => {
    provider.dispose();
  });

  test("showDetails opens a modbear details document for the picked dependency", async () => {
    const status = dependency({
      deprecatedMessage: "use example.com/new",
    });
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () =>
        snapshot({
          vulnerabilities: {
            state: "complete",
            findings: [
              {
                osvId: "GO-2026-0001",
                fixedVersion: "v1.2.3",
                classification: "reachable",
                trace: [{ module: status.modulePath }],
              },
            ],
            advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical parsing issue" } },
            errors: [],
          },
        }),
      detailsProvider: provider,
    };
    const env = stubEnvironment({ label: status.modulePath, status });
    try {
      await createShowDetailsHandler(context)();

      assert.equal(env.infos.length, 0);
      assert.equal(env.openedUris.length, 1);
      assert.equal(env.shownDocuments.length, 1);
      const uri = env.openedUris[0]!;
      assert.equal(uri.scheme, "modbear");
      assert.ok(uri.path.startsWith("/dependency/"));
      const content = provider.provideTextDocumentContent(uri);
      assert.match(content, /read-only/i);
      assert.match(content, /GO-2026-0001/);
      assert.match(content, /reachable/);
      assert.match(content, /v1\.2\.3/);
      assert.match(content, /use example\\\.com\/new/);
    } finally {
      env.restore();
    }
  });

  test("showDetails advises a scan when no snapshot exists", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => undefined,
      detailsProvider: provider,
    };
    const env = stubEnvironment(undefined);
    try {
      await createShowDetailsHandler(context)();
      assert.deepEqual(env.infos, [NO_SNAPSHOT_INFO]);
      assert.equal(env.openedUris.length, 0);
    } finally {
      env.restore();
    }
  });

  test("explainDependency renders the explanation into a details document", async () => {
    const status = dependency();
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot(),
      detailsProvider: provider,
    };
    const runExplain: ExplainRunner = async (explainedModule, modulePath) => {
      assert.equal(explainedModule.id, moduleContext.id);
      assert.equal(modulePath, status.modulePath);
      return "# example.com/app\nexample.com/app\nexample.com/library";
    };
    const env = stubEnvironment({ label: status.modulePath, status });
    try {
      await createExplainDependencyHandler(context, runExplain)();

      assert.equal(env.errors.length, 0);
      const uri = env.openedUris[0]!;
      assert.equal(uri.scheme, "modbear");
      assert.ok(uri.path.startsWith("/why/"));
      const content = provider.provideTextDocumentContent(uri);
      assert.match(content, /# example\.com\/app\nexample\.com\/app\nexample\.com\/library/);
    } finally {
      env.restore();
    }
  });

  test("explainDependency surfaces analyzer failures without opening documents", async () => {
    const status = dependency();
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot(),
      detailsProvider: provider,
    };
    const runExplain: ExplainRunner = async () => {
      throw new Error("go: example.com/library: module is not required");
    };
    const env = stubEnvironment({ label: status.modulePath, status });
    try {
      await createExplainDependencyHandler(context, runExplain)();

      assert.equal(env.openedUris.length, 0);
      assert.equal(env.errors.length, 1);
      assert.match(env.errors[0]!, /Could not explain example\.com\/library/);
      assert.match(env.errors[0]!, /module is not required/);
    } finally {
      env.restore();
    }
  });

  test("openAdvisory validates and then opens the advisory link externally", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () =>
        snapshot({
          vulnerabilities: {
            state: "complete",
            findings: [
              {
                osvId: "GO-2026-0001",
                classification: "reachable",
                trace: [{ module: "example.com/library" }],
              },
            ],
            advisories: {},
            errors: [],
          },
        }),
      detailsProvider: provider,
    };
    const env = stubEnvironment({ label: "GO-2026-0001", osvId: "GO-2026-0001" });
    try {
      await createOpenAdvisoryHandler(context)();

      assert.equal(env.externalUris.length, 1);
      const uri = env.externalUris[0]!;
      assert.equal(uri.scheme, "https");
      assert.ok(uri.toString().startsWith("https://pkg.go.dev/vuln/GO-2026-0001"));
    } finally {
      env.restore();
    }
  });

  test("openAdvisory never opens a link that fails validation", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () =>
        snapshot({
          vulnerabilities: {
            state: "complete",
            findings: [
              { osvId: "GO-2026-0009", classification: "imported", trace: [{ module: "example.com/library" }] },
            ],
            advisories: {},
            errors: [],
          },
        }),
      detailsProvider: provider,
    };
    const env = stubEnvironment({ label: "GO-2026-0009", osvId: "GO-2026-0009" });
    try {
      await createOpenAdvisoryHandler(context, () => "https://user:secret@example.test/advisory")();

      assert.equal(env.externalUris.length, 0);
      assert.equal(env.errors.length, 1);
      assert.match(env.errors[0]!, /credentials/);
    } finally {
      env.restore();
    }
  });

  test("openAdvisory advises a scan when no findings exist", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot(),
      detailsProvider: provider,
    };
    const env = stubEnvironment(undefined);
    try {
      await createOpenAdvisoryHandler(context)();
      assert.deepEqual(env.infos, [NO_ADVISORY_INFO]);
      assert.equal(env.externalUris.length, 0);
    } finally {
      env.restore();
    }
  });

  test("showTidyDiff opens the diff as a details document when one exists", async () => {
    const diff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot({ tidy: { state: "complete", consistent: false, diff, errors: [] } }),
      detailsProvider: provider,
    };
    const env = stubEnvironment(undefined);
    try {
      await createShowTidyDiffHandler(context)();

      const uri = env.openedUris[0]!;
      assert.equal(uri.scheme, "modbear");
      const content = provider.provideTextDocumentContent(uri);
      assert.match(content, /```diff/);
      assert.ok(content.includes(diff.trimEnd()));
    } finally {
      env.restore();
    }
  });

  test("showTidyDiff explains when no snapshot exists", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => undefined,
      detailsProvider: provider,
    };
    const env = stubEnvironment(undefined);
    try {
      await createShowTidyDiffHandler(context)();
      assert.deepEqual(env.infos, [NO_TIDY_ANALYSIS_INFO]);
      assert.equal(env.openedUris.length, 0);
    } finally {
      env.restore();
    }
  });

  test("showTidyDiff explains when the module is already tidy", async () => {
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot({ tidy: { state: "complete", consistent: true, errors: [] } }),
      detailsProvider: provider,
    };
    const env = stubEnvironment(undefined);
    try {
      await createShowTidyDiffHandler(context)();
      assert.deepEqual(env.infos, [NO_TIDY_DIFF_INFO]);
      assert.equal(env.openedUris.length, 0);
    } finally {
      env.restore();
    }
  });

  test("every detail command stays gated in an untrusted workspace", async () => {
    const originalIsTrusted = vscode.workspace.isTrusted;
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => false, configurable: true });
    const context: DetailCommandContext = {
      getActiveModule: () => moduleContext,
      getSnapshot: () => snapshot(),
      detailsProvider: provider,
    };
    const runExplain: ExplainRunner = async () => "should not run";
    const env = stubEnvironment({ label: "example.com/library", status: dependency() });
    try {
      await createShowDetailsHandler(context)();
      await createExplainDependencyHandler(context, runExplain)();
      await createOpenAdvisoryHandler(context)();
      await createShowTidyDiffHandler(context)();

      assert.deepEqual(env.warnings, [TRUST_WARNING, TRUST_WARNING, TRUST_WARNING, TRUST_WARNING]);
      assert.equal(env.infos.length, 0);
      assert.equal(env.openedUris.length, 0);
      assert.equal(env.externalUris.length, 0);
    } finally {
      env.restore();
      Object.defineProperty(vscode.workspace, "isTrusted", {
        get: () => originalIsTrusted,
        configurable: true,
      });
    }
  });
});
