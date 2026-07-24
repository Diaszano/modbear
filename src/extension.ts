import * as vscode from "vscode";
import { EXTENSION_ID } from "./metadata";
import { DiagnosticManager } from "./diagnostics/diagnosticManager";
import { AnalysisCache } from "./cache/analysisCache";
import { ScanCoordinator } from "./orchestration/scanCoordinator";
import { ModuleScanner } from "./orchestration/moduleScanner";
import { DependencyHoverProvider } from "./providers/dependencyHoverProvider";
import { DependencyInlayHintsProvider } from "./providers/dependencyInlayHintsProvider";
import { StatusBarManager } from "./providers/statusBarManager";
import {
  PREPARE_UPDATE_COMMAND_ID,
  TerminalUpdateManager
} from "./providers/terminalUpdateManager";
import { discoverModules, type ModuleDiscoveryResult } from "./discovery/moduleDiscovery";
import { resolveActiveModule } from "./discovery/activeModuleResolver";
import { readConfig } from "./config/config";
import { mapUpdateDiagnostics } from "./diagnostics/updateDiagnosticMapper";
import { mapReplacementDiagnostics } from "./diagnostics/replacementDiagnosticMapper";
import { parseGoModPositions } from "./parsers/goModPositionParser";
import { ModuleAnalysisSnapshot, getSnapshotMetrics } from "./domain/analysis";
import type { ModuleContext } from "./domain/module";
import { Logger } from "./logging/logger";
import { resolveTool } from "./execution/toolResolver";
import { ProcessExecutionError } from "./execution/processRunner";
import { VulnerabilityCoordinator } from "./analyzers/vulnerabilityAnalyzer";

import { mapVulnerabilityDiagnostics } from "./diagnostics/vulnerabilityDiagnosticMapper";

export { EXTENSION_ID };

async function requireTrustedWorkspace(): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  await vscode.window.showWarningMessage("Trust this workspace before running ModBear workspace actions.");
  return false;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = new Logger(() => readConfig().logLevel);
  const diagnosticManager = new DiagnosticManager();
  
  const cachePath = context.globalStorageUri.fsPath;
  const cache = new AnalysisCache(cachePath);
  const coordinator = new ScanCoordinator(() => getConfig().maxConcurrentModules);
  const statusBarManager = new StatusBarManager(coordinator);
  const terminalUpdateManager = new TerminalUpdateManager(
    (options) => vscode.window.createTerminal(options)
  );
  
  let modules: readonly ModuleContext[] = [];
  
  const resolveModule = (uri: vscode.Uri) => resolveActiveModule(uri.fsPath, modules);
  
  const getConfig = () => readConfig();
  let vulnerabilityCoordinator: VulnerabilityCoordinator | undefined;

  const logFailure = (name: string, error: unknown): void => {
    if (error instanceof ProcessExecutionError) {
      output.event("error", name, {
        kind: error.kind,
        ...(error.result?.stderr ? { stderr: error.result.stderr } : {})
      });
      return;
    }
    output.event("error", name, {
      detail: error instanceof Error ? error.message : String(error)
    });
  };

  const logWarning = (name: string, error: unknown): void => {
    output.event("warn", name, {
      detail: error instanceof Error ? error.message : String(error)
    });
  };
  
  const requestScan = async (module: ModuleContext) => {
    if (!vscode.workspace.isTrusted) return;
    const config = getConfig();
    if (!config.enabled) return;
    let goPath = config.goPath;
    statusBarManager.markScanStarted(module.id);
    try {
      goPath = await resolveTool(config.goPath, "go");
    } catch (err) {
      statusBarManager.markScanFinished(module.id);
      logFailure("tool.resolve.failed", err);
      vscode.window.showWarningMessage("ModBear: Could not resolve Go executable.");
      return;
    }
    const vulnerability = config.vulnerabilityEnabled
      ? {
          enabled: true,
          govulncheckPath: config.govulncheckPath,
          timeoutMs: config.vulnerabilityTimeoutSeconds * 1000,
          coordinator: vulnerabilityCoordinator ??= new VulnerabilityCoordinator()
        }
      : undefined;
    const scanner = new ModuleScanner(
      cache,
      goPath,
      config.timeoutSeconds * 1000,
      config.updateTtlMinutes * 60000,
      output,
      vulnerability
    );
    coordinator.scanModule({
      module,
      contentHash: "",
      run: (signal) => scanner.scan(module, signal)
    }).catch(err => {
      if (err instanceof Error && err.message === "Scan cancelled") {
        statusBarManager.markScanFinished(module.id);
        return;
      }
      logFailure("scan.failed", err);
    });
  };

  const hoverProvider = new DependencyHoverProvider(coordinator, resolveModule);
  const inlayProvider = new DependencyInlayHintsProvider(coordinator, resolveModule, requestScan);

  context.subscriptions.push(
    output,
    diagnosticManager,
    coordinator,
    inlayProvider,
    statusBarManager,
    vscode.window.onDidCloseTerminal((terminal) => terminalUpdateManager.forget(terminal))
  );

  const documentSelector: vscode.DocumentSelector = { pattern: "**/go.mod", scheme: "file" };
  
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, hoverProvider),
    vscode.languages.registerInlayHintsProvider(documentSelector, inlayProvider)
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
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    discoverModules(roots, new AbortController().signal)
      .then(handleDiscoveryResult)
      .catch(err => logFailure("discovery.failed", err));
  }

  coordinator.events.onSnapshot((snapshot) => {
    statusBarManager.markScanFinished(snapshot.moduleId);
    inlayProvider.refresh();

    if (snapshot.updateState === "failed") {
      void vscode.window.showWarningMessage("ModBear: Dependency scan failed. See the output for details.");
    }
    
    const module = modules.find(m => m.id === snapshot.moduleId);
    if (!module) return;
    
    const uri = vscode.Uri.file(module.goModPath);
    vscode.workspace.openTextDocument(uri).then(doc => {
      const parsed = parseGoModPositions(doc.getText());
      const diagnostics: vscode.Diagnostic[] = [];
      const config = readConfig(doc.uri);
      
      for (const req of parsed.requirements) {
        const status = snapshot.dependencies.find(d => d.modulePath === req.modulePath);
        if (status) {
          diagnostics.push(...mapUpdateDiagnostics(req, status, config.updateSeverity));
        }
      }
      
      for (const rep of parsed.replacements) {
        const status = snapshot.replacements.find(r => r.sourcePath === rep.oldPath);
        if (status) {
          diagnostics.push(...mapReplacementDiagnostics(rep, status));
        }
      }
      
      diagnostics.push(...mapVulnerabilityDiagnostics(parsed.requirements, snapshot.vulnerabilities));
      
      diagnosticManager.set(doc.uri, diagnostics);
    }, err => logFailure("diagnostics.open.failed", err));
  });

  const scheduler = new ScanScheduler(requestScan);
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
    vscode.workspace.onDidOpenTextDocument(doc => triggerScan(doc, false)),
    vscode.workspace.onDidSaveTextDocument(doc => triggerScan(doc, true))
  );

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
      const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
      let result: ModuleDiscoveryResult;
      try {
        result = await discoverModules(roots, new AbortController().signal);
      } catch (error) {
        logFailure("discovery.failed", error);
        await vscode.window.showWarningMessage("ModBear: Could not discover Go modules.");
        return;
      }
      handleDiscoveryResult(result);
      for (const module of modules) requestScan(module);
    }),
    vscode.commands.registerCommand("modBear.copySuggestion", async (suggestion: string) => {
      await vscode.env.clipboard.writeText(suggestion);
    }),
    vscode.commands.registerCommand("modBear.showOutput", () => {
      output.show();
    }),
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

  public constructor(
    private readonly requestScan: (module: ModuleContext) => void
  ) {}

  public triggerScan(
    module: ModuleContext,
    isSave: boolean,
    config: ScanSchedulerConfig
  ): void {
    if (!config.enabled) return;
    if (isSave && !config.onSave) return;
    if (!isSave && !config.onOpen) return;

    const existing = this.scanTimeouts.get(module.id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.scanTimeouts.delete(module.id);
      this.requestScan(module);
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
