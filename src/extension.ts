import * as vscode from "vscode";
import { EXTENSION_ID } from "./metadata";
import { DiagnosticManager } from "./diagnostics/diagnosticManager";
import { AnalysisCache } from "./cache/analysisCache";
import { ScanCoordinator } from "./orchestration/scanCoordinator";
import { ModuleScanner, type ScanTrigger } from "./orchestration/moduleScanner";
import { DependencyHoverProvider } from "./providers/dependencyHoverProvider";
import { DependencyInlayHintsProvider } from "./providers/dependencyInlayHintsProvider";
import { DependencyCodeActionsProvider } from "./providers/dependencyCodeActionsProvider";
import { StatusBarManager } from "./providers/statusBarManager";
import {
  PREPARE_UPDATE_COMMAND_ID,
  TerminalUpdateManager
} from "./providers/terminalUpdateManager";
import { discoverModules, type ModuleDiscoveryResult } from "./discovery/moduleDiscovery";
import { resolveActiveModule } from "./discovery/activeModuleResolver";
import { readConfig, type ExtensionConfig } from "./config/config";
import { mapUpdateDiagnostics } from "./diagnostics/updateDiagnosticMapper";
import { mapReplacementDiagnostics } from "./diagnostics/replacementDiagnosticMapper";
import { GoModDocumentCache } from "./parsers/goModDocumentCache";
import { ModuleAnalysisSnapshot, getSnapshotMetrics } from "./domain/analysis";
import type { ModuleContext } from "./domain/module";
import { Logger } from "./logging/logger";
import { resolveTool } from "./execution/toolResolver";
import { ProcessExecutionError } from "./execution/processRunner";
import { VulnerabilityCoordinator } from "./analyzers/vulnerabilityAnalyzer";
import { mapVulnerabilityDiagnostics } from "./diagnostics/vulnerabilityDiagnosticMapper";
import { mapTidyDiagnostic } from "./diagnostics/tidyDiagnosticMapper";
import { mapToolchainDiagnostics } from "./diagnostics/toolchainDiagnosticMapper";
import { DetailsDocumentProvider, validateAdvisoryUri } from "./providers/detailsDocumentProvider";
import { explainDependency } from "./analyzers/whyAnalyzer";
import type { ParsedGoMod } from "./domain/dependency";

export { EXTENSION_ID };

export function buildSnapshotDiagnostics(
  parsed: ParsedGoMod,
  snapshot: Pick<ModuleAnalysisSnapshot, "dependencies" | "replacements" | "vulnerabilities" | "tidy" | "toolchain">,
  updateSeverity: ExtensionConfig["updateSeverity"]
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const dependenciesByPath = new Map(snapshot.dependencies.map((status) => [status.modulePath, status]));
  for (const requirement of parsed.requirements) {
    const status = dependenciesByPath.get(requirement.modulePath);
    if (status) {
      diagnostics.push(...mapUpdateDiagnostics(requirement, status, updateSeverity));
    }
  }

  for (const replacement of parsed.replacements) {
    const status = snapshot.replacements.find((item) => item.sourcePath === replacement.oldPath);
    if (status) {
      diagnostics.push(...mapReplacementDiagnostics(replacement, status));
    }
  }

  diagnostics.push(...mapVulnerabilityDiagnostics(parsed.requirements, snapshot.vulnerabilities));
  const tidyDiagnostic = mapTidyDiagnostic(parsed, snapshot.tidy);
  if (tidyDiagnostic) diagnostics.push(tidyDiagnostic);
  diagnostics.push(...mapToolchainDiagnostics(parsed, snapshot.toolchain));
  return diagnostics;
}

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
  const coordinator = new ScanCoordinator(() => getConfig().maxConcurrentModules, output);
  const statusBarManager = new StatusBarManager(coordinator);
  const terminalUpdateManager = new TerminalUpdateManager(
    (options) => vscode.window.createTerminal(options)
  );
  const detailsDocumentProvider = new DetailsDocumentProvider();
  
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
  
  const requestScan = async (module: ModuleContext, trigger: ScanTrigger = "background") => {
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
          coordinator: vulnerabilityCoordinator ??= new VulnerabilityCoordinator(),
          includeTests: config.vulnerabilityIncludeTests,
          buildTags: config.vulnerabilityBuildTags,
          database: config.vulnerabilityDatabase
        }
      : undefined;
    const scanner = new ModuleScanner(
      cache,
      goPath,
      config.timeoutSeconds * 1000,
      config.updateTtlMinutes * 60000,
      output,
      vulnerability,
      {
        tidyEnabled: config.tidyEnabled,
        tidyTtlMs: config.tidyTtlMinutes * 60_000,
        vulnerabilityTtlMs: config.vulnerabilityTtlMinutes * 60_000
      }
    );
    coordinator.scanModule({
      module,
      contentHash: "",
      run: (signal) => scanner.scan(module, signal, trigger)
    }).catch(err => {
      if (err instanceof Error && err.message === "Scan cancelled") {
        statusBarManager.markScanFinished(module.id);
        return;
      }
      // Failure is already logged by ModuleScanner.scan
    });
  };

  const documentCache = new GoModDocumentCache();

  const hoverProvider = new DependencyHoverProvider(coordinator, resolveModule, documentCache);
  const inlayProvider = new DependencyInlayHintsProvider(coordinator, resolveModule, requestScan, documentCache);
  const codeActionsProvider = new DependencyCodeActionsProvider(coordinator, resolveModule, documentCache);

  context.subscriptions.push(
    output,
    diagnosticManager,
    coordinator,
    inlayProvider,
    codeActionsProvider,
    statusBarManager,
    detailsDocumentProvider,
    documentCache,
    vscode.workspace.onDidCloseTextDocument((doc) => documentCache.delete(doc.uri)),
    vscode.window.onDidCloseTerminal((terminal) => terminalUpdateManager.forget(terminal))
  );

  const documentSelector: vscode.DocumentSelector = { pattern: "**/go.mod", scheme: "file" };
  
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, hoverProvider),
    vscode.languages.registerInlayHintsProvider(documentSelector, inlayProvider),
    vscode.languages.registerCodeActionsProvider(documentSelector, codeActionsProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
    }),
    vscode.workspace.registerTextDocumentContentProvider("modbear", detailsDocumentProvider)
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
      const parsed = documentCache.get(doc);
      const config = readConfig(doc.uri);
      diagnosticManager.set(doc.uri, buildSnapshotDiagnostics(parsed, snapshot, config.updateSeverity));
    }, err => logFailure("diagnostics.open.failed", err));
  });

  const scheduler = new ScanScheduler(requestScan);
  activeScheduler = scheduler;
  context.subscriptions.push(scheduler);

  const triggerScan = (doc: vscode.TextDocument, trigger: ScanTrigger) => {
    if (!doc.fileName.endsWith("go.mod")) return;
    if (!vscode.workspace.isTrusted) return;
    
    const module = resolveModule(doc.uri);
    if (!module) return;
    
    const config = readConfig(doc.uri);
    scheduler.triggerScan(module, trigger, config);
  };

  const currentSnapshot = () => {
    const document = vscode.window.activeTextEditor?.document;
    const module = document ? resolveModule(document.uri) : undefined;
    const snapshot = module ? coordinator.getSnapshot(module.id) : undefined;
    return module && snapshot ? { module, snapshot } : undefined;
  };

  const requestedModulePath = (input: unknown): string | undefined => {
    if (typeof input === "string") return input;
    if (typeof input !== "object" || !input) return undefined;
    const value = (input as { modulePath?: unknown }).modulePath;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const showVirtualDocument = async (uri: vscode.Uri): Promise<void> => {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => triggerScan(doc, "background")),
    vscode.workspace.onDidSaveTextDocument(doc => triggerScan(doc, "save"))
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
      for (const module of modules) requestScan(module, "manual");
    }),
    vscode.commands.registerCommand("modBear.copySuggestion", async (suggestion: string) => {
      await vscode.env.clipboard.writeText(suggestion);
    }),
    vscode.commands.registerCommand("modBear.showDetails", async (input: unknown) => {
      if (!(await requireTrustedWorkspace())) return;
      const modulePath = requestedModulePath(input);
      const osvId = typeof input === "object" && input ? (input as { osvId?: unknown }).osvId : undefined;
      const current = currentSnapshot();
      if (!modulePath || typeof osvId !== "string" || !current) return;
      if (!current.snapshot.dependencies.some((dependency) => dependency.modulePath === modulePath)) return;
      const finding = current.snapshot.vulnerabilities.findings.find((item) =>
        item.osvId === osvId && item.trace.some((frame) => frame.module === modulePath)
      );
      if (!finding) return;
      const advisory = current.snapshot.vulnerabilities.advisories[finding.osvId];
      const safeId = finding.osvId.replace(/[^A-Za-z0-9._-]/g, "_");
      const content = [
        `# ${safeId}`,
        "",
        `Classification: ${finding.classification}`,
        finding.fixedVersion ? `Fixed in: ${finding.fixedVersion}` : "Fixed version: unavailable",
        advisory?.summary ? `Summary: ${advisory.summary}` : undefined,
        advisory?.details ? `\n${advisory.details}` : undefined
      ].filter((line): line is string => Boolean(line)).join("\n");
      await showVirtualDocument(detailsDocumentProvider.set("vulnerability", safeId, content));
    }),
    vscode.commands.registerCommand("modBear.showTidyDiff", async () => {
      if (!(await requireTrustedWorkspace())) return;
      const current = currentSnapshot();
      if (!current?.snapshot.tidy.diff) return;
      await showVirtualDocument(detailsDocumentProvider.set("tidy", current.module.id, current.snapshot.tidy.diff));
    }),
    vscode.commands.registerCommand("modBear.explainDependency", async (input: unknown) => {
      if (!(await requireTrustedWorkspace())) return;
      const modulePath = requestedModulePath(input);
      const current = currentSnapshot();
      if (!modulePath || !current || !current.snapshot.dependencies.some((dependency) => dependency.modulePath === modulePath)) return;
      try {
        const config = getConfig();
        const text = await explainDependency({
          module: current.module,
          snapshot: current.snapshot,
          modulePath,
          goExecutable: await resolveTool(config.goPath, "go"),
          timeoutMs: config.timeoutSeconds * 1000,
          signal: new AbortController().signal,
          trusted: vscode.workspace.isTrusted,
          logger: output
        });
        await showVirtualDocument(detailsDocumentProvider.set("why", modulePath, text));
      } catch (error) {
        logFailure("dependency.explain.failed", error);
        await vscode.window.showErrorMessage("ModBear: Could not explain the selected dependency.");
      }
    }),
    vscode.commands.registerCommand("modBear.openAdvisory", async (input: unknown) => {
      if (!(await requireTrustedWorkspace())) return;
      const value = typeof input === "string"
        ? input
        : typeof input === "object" && input && typeof (input as { url?: unknown }).url === "string"
          ? (input as { url: string }).url
          : undefined;
      if (!value) return;
      try {
        await vscode.env.openExternal(validateAdvisoryUri(value, output));
      } catch (error) {
        logFailure("advisory.open.failed", error);
        await vscode.window.showErrorMessage("ModBear: Invalid vulnerability advisory URL.");
      }
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
    private readonly requestScan: (module: ModuleContext, trigger?: ScanTrigger) => void
  ) {}

  public triggerScan(
    module: ModuleContext,
    trigger: ScanTrigger | boolean,
    config: ScanSchedulerConfig
  ): void {
    if (!config.enabled) return;
    const scanTrigger: ScanTrigger = trigger === "save" || trigger === true ? "save" : "background";
    if (scanTrigger === "save" && !config.onSave) return;
    if (scanTrigger === "background" && !config.onOpen) return;

    const existing = this.scanTimeouts.get(module.id);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.scanTimeouts.delete(module.id);
      this.requestScan(module, scanTrigger);
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
