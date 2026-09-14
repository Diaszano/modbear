import * as vscode from "vscode";
import { AnalysisCache } from "./cache/analysisCache";
import { ScanCoordinator } from "./orchestration/scanCoordinator";
import { ModuleScanner, type ScanTrigger } from "./orchestration/moduleScanner";
import { DependencyHoverProvider } from "./providers/dependencyHoverProvider";
import { DependencyInlayHintsProvider } from "./providers/dependencyInlayHintsProvider";
import { StatusBarManager } from "./providers/statusBarManager";
import { PREPARE_UPDATE_COMMAND_ID, TerminalUpdateManager } from "./providers/terminalUpdateManager";
import { DetailsDocumentProvider, MODBEAR_DETAILS_SCHEME } from "./providers/detailsDocumentProvider";
import {
  createExplainDependencyHandler,
  createOpenAdvisoryHandler,
  createShowDetailsHandler,
  createShowTidyDiffHandler,
  requireTrustedWorkspace,
  type DetailCommandContext,
  type ExplainRunner,
} from "./commands/detailsCommands";
import { discoverModules, resolveActiveModule, type ModuleDiscoveryResult } from "./discovery/moduleDiscovery";
import { readConfig } from "./config/config";
import { mergeHealthDiagnostics } from "./diagnostics/healthDiagnostics";
import { GoModDocumentCache } from "./parsers/goModDocumentCache";
import { getSnapshotMetrics } from "./domain/analysis";
import type { ModuleContext } from "./domain/module";
import { Logger } from "./logging/logger";
import { resolveTool } from "./execution/toolResolver";
import { ProcessExecutionError } from "./execution/processRunner";
import { VulnerabilityCoordinator } from "./analyzers/vulnerabilityAnalyzer";
import { explainDependency } from "./analyzers/whyAnalyzer";

export const EXTENSION_ID = "diaszano.modbear";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = new Logger(() => readConfig().logLevel);
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("modbear");

  const cachePath = context.globalStorageUri.fsPath;
  const cache = new AnalysisCache(cachePath);
  const coordinator = new ScanCoordinator(() => getConfig().maxConcurrentModules, output);
  const statusBarManager = new StatusBarManager(coordinator);
  const terminalUpdateManager = new TerminalUpdateManager((options) => vscode.window.createTerminal(options));

  let modules: readonly ModuleContext[] = [];

  const resolveModule = (uri: vscode.Uri) => resolveActiveModule(uri.fsPath, modules);

  const getConfig = () => readConfig();
  let vulnerabilityCoordinator: VulnerabilityCoordinator | undefined;

  const logFailure = (name: string, error: unknown): void => {
    if (error instanceof ProcessExecutionError) {
      output.event("error", name, {
        kind: error.kind,
        ...(error.result?.stderr ? { stderr: error.result.stderr } : {}),
      });
      return;
    }
    output.event("error", name, {
      detail: error instanceof Error ? error.message : String(error),
    });
  };

  const logWarning = (name: string, error: unknown): void => {
    output.event("warn", name, {
      detail: error instanceof Error ? error.message : String(error),
    });
  };

  const requestScan = async (module: ModuleContext, trigger: ScanTrigger = "background") => {
    if (!vscode.workspace.isTrusted) return;
    const config = getConfig();
    if (!config.enabled) return;
    let goPath: string;
    statusBarManager.markScanStarted(module.id);
    try {
      goPath = await resolveTool(config.goPath, "go");
    } catch (err) {
      statusBarManager.markScanFinished(module.id);
      logFailure("tool.resolve.failed", err);
      vscode.window.showWarningMessage("ModBear: Could not resolve Go executable.");
      return;
    }
    const vulnerabilityCoordinatorInstance = (vulnerabilityCoordinator ??= new VulnerabilityCoordinator());
    const vulnerability = config.vulnerabilityEnabled
      ? {
          enabled: true,
          govulncheckPath: config.govulncheckPath,
          timeoutMs: config.vulnerabilityTimeoutSeconds * 1000,
          ttlMs: config.vulnerabilityTtlMinutes * 60000,
          includeTests: config.vulnerabilityIncludeTests,
          buildTags: config.vulnerabilityBuildTags,
          database: config.vulnerabilityDatabase,
          importedSeverity: config.importedVulnerabilitySeverity,
          coordinator: vulnerabilityCoordinatorInstance,
        }
      : undefined;
    const health = { tidyEnabled: config.tidyEnabled, ttlMs: config.tidyTtlMinutes * 60000 };
    const scanner = new ModuleScanner(
      cache,
      goPath,
      config.timeoutSeconds * 1000,
      config.updateTtlMinutes * 60000,
      output,
      vulnerability,
      health,
    );
    coordinator
      .scanModule({
        module,
        contentHash: "",
        run: (signal) => scanner.scan(module, signal, trigger),
      })
      .catch((err) => {
        if (err instanceof Error && err.message === "Scan cancelled") {
          statusBarManager.markScanFinished(module.id);
          return;
        }
        // Failure is already logged by ModuleScanner.scan
      });
  };

  const documentCache = new GoModDocumentCache();
  const detailsProvider = new DetailsDocumentProvider();

  const hoverProvider = new DependencyHoverProvider(coordinator, resolveModule, documentCache);
  const inlayProvider = new DependencyInlayHintsProvider(
    coordinator,
    resolveModule,
    (module) => void requestScan(module),
    documentCache,
  );

  context.subscriptions.push(
    output,
    diagnosticCollection,
    coordinator,
    inlayProvider,
    statusBarManager,
    documentCache,
    detailsProvider,
    vscode.workspace.registerTextDocumentContentProvider(MODBEAR_DETAILS_SCHEME, detailsProvider),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      documentCache.delete(doc.uri);
    }),
    vscode.window.onDidCloseTerminal((terminal) => {
      terminalUpdateManager.forget(terminal);
    }),
  );

  const documentSelector: vscode.DocumentSelector = { pattern: "**/go.mod", scheme: "file" };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, hoverProvider),
    vscode.languages.registerInlayHintsProvider(documentSelector, inlayProvider),
  );

  const handleDiscoveryResult = (result: ModuleDiscoveryResult) => {
    modules = result.modules;
    statusBarManager.setModules(result.modules);
    for (const err of result.errors) {
      logWarning("discovery.warning", err);
    }
    inlayProvider.refresh();
  };

  if (vscode.workspace.isTrusted) {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    discoverModules(roots, new AbortController().signal)
      .then(handleDiscoveryResult)
      .catch((err) => {
        logFailure("discovery.failed", err);
      });
  }

  coordinator.onSnapshot((snapshot) => {
    statusBarManager.markScanFinished(snapshot.moduleId);
    inlayProvider.refresh();

    if (snapshot.updateState === "failed") {
      void vscode.window.showWarningMessage("ModBear: Dependency scan failed. See the output for details.");
    }
    const module = modules.find((m) => m.id === snapshot.moduleId);
    if (!module) return;

    const uri = vscode.Uri.file(module.goModPath);
    vscode.workspace.openTextDocument(uri).then(
      (doc) => {
        const parsed = documentCache.get(doc);
        const diagnostics = mergeHealthDiagnostics(parsed, snapshot, readConfig(doc.uri).updateSeverity);
        diagnosticCollection.set(doc.uri, diagnostics);
      },
      (err) => {
        logFailure("diagnostics.open.failed", err);
      },
    );
  });

  const scheduler = new ScanScheduler((module) => void requestScan(module));
  activeScheduler = scheduler;
  context.subscriptions.push(scheduler);

  const triggerScan = (doc: vscode.TextDocument, isSave: boolean) => {
    if (!doc.fileName.endsWith("go.mod")) return;
    if (!vscode.workspace.isTrusted) return;

    const module = resolveModule(doc.uri);
    if (!module) return;

    const config = readConfig(doc.uri);
    scheduler.triggerScan(module, isSave, config);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      triggerScan(doc, false);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      triggerScan(doc, true);
    }),
  );

  const detailCommandContext: DetailCommandContext = {
    getActiveModule: () => {
      const editor = vscode.window.activeTextEditor;
      return editor ? resolveModule(editor.document.uri) : undefined;
    },
    getSnapshot: (moduleId) => coordinator.getSnapshot(moduleId),
    detailsProvider,
  };

  const runExplanation: ExplainRunner = async (module, modulePath, signal) => {
    const config = getConfig();
    return explainDependency({
      module,
      modulePath,
      signal,
      goExecutable: await resolveTool(config.goPath, "go"),
      timeoutMs: config.timeoutSeconds * 1000,
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(PREPARE_UPDATE_COMMAND_ID, async (input: unknown) => {
      if (!(await requireTrustedWorkspace())) return;
      try {
        terminalUpdateManager.prepare(input);
      } catch (error) {
        logFailure("update.prepare.failed", error);
        const suffix = error instanceof Error ? `: ${error.message}` : "";
        await vscode.window.showErrorMessage(`ModBear: Could not prepare update${suffix}`);
      }
    }),
    vscode.commands.registerCommand("modBear.scanWorkspace", async () => {
      if (!(await requireTrustedWorkspace())) return;
      output.info("Manual scan triggered");
      const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      let result: ModuleDiscoveryResult;
      try {
        result = await discoverModules(roots, new AbortController().signal);
      } catch (error) {
        logFailure("discovery.failed", error);
        await vscode.window.showWarningMessage("ModBear: Could not discover Go modules.");
        return;
      }
      handleDiscoveryResult(result);
      for (const module of modules) void requestScan(module, "manual");
    }),
    vscode.commands.registerCommand("modBear.copySuggestion", async (suggestion: string) => {
      await vscode.env.clipboard.writeText(suggestion);
    }),
    vscode.commands.registerCommand("modBear.scanModule", async () => {
      if (!(await requireTrustedWorkspace())) return;
      const editor = vscode.window.activeTextEditor;
      const module = editor ? resolveModule(editor.document.uri) : undefined;
      if (!module) {
        void vscode.window.showWarningMessage("ModBear: Open a file inside a Go module to scan it.");
        return;
      }
      output.info("Manual module scan triggered");
      await requestScan(module, "manual");
    }),
    vscode.commands.registerCommand("modBear.showDetails", createShowDetailsHandler(detailCommandContext)),
    vscode.commands.registerCommand(
      "modBear.explainDependency",
      createExplainDependencyHandler(detailCommandContext, runExplanation),
    ),
    vscode.commands.registerCommand("modBear.openAdvisory", createOpenAdvisoryHandler(detailCommandContext)),
    vscode.commands.registerCommand("modBear.showTidyDiff", createShowTidyDiffHandler(detailCommandContext)),
    vscode.commands.registerCommand("modBear.showOutput", () => {
      output.show();
    }),
    vscode.commands.registerCommand("modBear.showStatusBarMenu", async () => {
      const items = [
        {
          label: "$(sync) Scan Workspace",
          description: "Force scan all Go modules in the workspace",
          action: () => vscode.commands.executeCommand("modBear.scanWorkspace"),
        },
        {
          label: "$(output) Show Output Logs",
          description: "Open ModBear's output channel to view logs",
          action: () => vscode.commands.executeCommand("modBear.showOutput"),
        },
      ];

      for (const module of modules) {
        const snap = coordinator.getSnapshot(module.id);
        let detail = "Scan pending...";
        if (snap) {
          if (snap.updateState === "failed") {
            detail = "Scan failed";
          } else {
            const { updates, warnings } = getSnapshotMetrics(snap);
            detail = updates === 0 && warnings === 0 ? "Up to date" : `${updates} updates, ${warnings} warnings`;
          }
        }
        items.push({
          label: `$(file-code) ${module.id}`,
          description: detail,
          action: async () => {
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(module.goModPath));
              await vscode.window.showTextDocument(doc);
            } catch (err) {
              logFailure("module.open.failed", err);
              vscode.window.showErrorMessage("ModBear: Could not open module file.");
            }
          },
        });
      }

      const selected = await vscode.window.showQuickPick(items, {
        title: "ModBear: Go Dependency Insights",
        placeHolder: "Select an action or module",
      });

      if (selected) {
        await selected.action();
      }
    }),
  );

  output.info(`${EXTENSION_ID} activated; trusted=${vscode.workspace.isTrusted}`);
}

let activeScheduler: ScanScheduler | undefined;

export function deactivate(): void {
  if (activeScheduler) {
    activeScheduler.dispose();
    activeScheduler = undefined;
  }
}

export interface ScanSchedulerConfig {
  readonly enabled: boolean;
  readonly onSave: boolean;
  readonly onOpen: boolean;
}

export class ScanScheduler implements vscode.Disposable {
  private readonly scanTimeouts = new Map<string, NodeJS.Timeout>();

  public constructor(private readonly requestScan: (module: ModuleContext, trigger: ScanTrigger) => void) {}

  public triggerScan(module: ModuleContext, isSave: boolean, config: ScanSchedulerConfig): void {
    if (!config.enabled) return;
    if (isSave && !config.onSave) return;
    if (!isSave && !config.onOpen) return;

    const existing = this.scanTimeouts.get(module.id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.scanTimeouts.delete(module.id);
      this.requestScan(module, isSave ? "save" : "background");
    }, 500);

    this.scanTimeouts.set(module.id, timer);
  }

  public dispose(): void {
    for (const timer of this.scanTimeouts.values()) {
      clearTimeout(timer);
    }
    this.scanTimeouts.clear();
  }
}
