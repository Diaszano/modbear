import * as vscode from "vscode";
import { EXTENSION_ID } from "./metadata";
import { DiagnosticManager } from "./diagnostics/diagnosticManager";
import { AnalysisCache } from "./cache/analysisCache";
import { ScanCoordinator } from "./orchestration/scanCoordinator";
import { ModuleScanner } from "./orchestration/moduleScanner";
import { DependencyHoverProvider } from "./providers/dependencyHoverProvider";
import { DependencyInlayHintsProvider } from "./providers/dependencyInlayHintsProvider";
import { discoverModules } from "./discovery/moduleDiscovery";
import { resolveActiveModule } from "./discovery/activeModuleResolver";
import { readConfig } from "./config/config";
import { mapUpdateDiagnostics } from "./diagnostics/updateDiagnosticMapper";
import { mapReplacementDiagnostics } from "./diagnostics/replacementDiagnosticMapper";
import { parseGoModPositions } from "./parsers/goModPositionParser";
import type { ModuleContext } from "./domain/module";
import { Logger } from "./logging/logger";
import { resolveTool } from "./execution/toolResolver";

export { EXTENSION_ID };

async function requireTrustedWorkspace(): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  await vscode.window.showWarningMessage("Trust this workspace before running Go dependency analysis.");
  return false;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = new Logger();
  const diagnosticManager = new DiagnosticManager();
  
  const cachePath = context.globalStorageUri.fsPath;
  const cache = new AnalysisCache(cachePath);
  const coordinator = new ScanCoordinator(() => getConfig().maxConcurrentModules);
  
  let modules: readonly ModuleContext[] = [];
  
  const resolveModule = (uri: vscode.Uri) => resolveActiveModule(uri.fsPath, modules);
  
  const getConfig = () => readConfig();
  
  const requestScan = async (module: ModuleContext) => {
    const config = getConfig();
    let goPath = config.goPath;
    try {
      goPath = await resolveTool(config.goPath, "go");
    } catch (err) {
      vscode.window.showWarningMessage(`ModBear: Could not resolve go executable (${config.goPath}): ${err instanceof Error ? err.message : err}`);
      return;
    }
    const scanner = new ModuleScanner(cache, goPath, config.timeoutSeconds * 1000, config.updateTtlMinutes * 60000, output);
    coordinator.scanModule({
      module,
      contentHash: "",
      run: (signal) => scanner.scan(module, signal)
    }).catch(err => output.error(`Scan failed for ${module.id}: ${err}`));
  };

  const hoverProvider = new DependencyHoverProvider(coordinator, resolveModule);
  const inlayProvider = new DependencyInlayHintsProvider(coordinator, resolveModule, requestScan);

  context.subscriptions.push(
    output,
    diagnosticManager,
    coordinator,
    inlayProvider
  );

  const documentSelector: vscode.DocumentSelector = { pattern: "**/go.mod", scheme: "file" };
  
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(documentSelector, hoverProvider),
    vscode.languages.registerInlayHintsProvider(documentSelector, inlayProvider)
  );

  if (vscode.workspace.isTrusted) {
    const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    discoverModules(roots, new AbortController().signal).then(m => { modules = m; });
  }

  coordinator.events.onSnapshot((snapshot) => {
    inlayProvider.refresh();
    
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
      
      diagnosticManager.set(doc.uri, diagnostics);
    }, err => output.error(`Could not open document for diagnostics: ${err}`));
  });

  let scanTimeout: NodeJS.Timeout | undefined;
  const triggerScan = (doc: vscode.TextDocument, isSave: boolean) => {
    if (!doc.fileName.endsWith("go.mod")) return;
    const config = readConfig(doc.uri);
    if (isSave && !config.onSave) return;
    if (!isSave && !config.onOpen) return;
    if (!vscode.workspace.isTrusted) return;
    
    const module = resolveModule(doc.uri);
    if (!module) return;
    
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => requestScan(module), 500);
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => triggerScan(doc, false)),
    vscode.workspace.onDidSaveTextDocument(doc => triggerScan(doc, true))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("modBear.scanWorkspace", async () => {
      if (!(await requireTrustedWorkspace())) return;
      output.info("Manual scan triggered");
      const roots = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
      modules = await discoverModules(roots, new AbortController().signal);
      for (const module of modules) requestScan(module);
    }),
    vscode.commands.registerCommand("modBear.copySuggestion", async (suggestion: string) => {
      await vscode.env.clipboard.writeText(suggestion);
    }),
    vscode.commands.registerCommand("modBear.showOutput", () => {
      output.show();
    })
  );

  output.info(`${EXTENSION_ID} activated; trusted=${vscode.workspace.isTrusted}`);
}

export function deactivate(): void {}
