import * as vscode from "vscode";
import type { DependencyStatus, ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import type { DetailsDocumentProvider } from "../providers/detailsDocumentProvider";
import {
  buildAdvisoryLink,
  buildDependencyDetailsContent,
  buildTidyDiffContent,
  buildWhyDetailsContent,
} from "../providers/detailsContent";
import { validateAdvisoryUri } from "../security/advisoryUri";

export const TRUST_WARNING = "Trust this workspace before running ModBear workspace actions.";
export const NO_SNAPSHOT_INFO = "ModBear: No dependency details available yet. Run a scan first.";
export const NO_TIDY_ANALYSIS_INFO = "ModBear: No tidy analysis available yet. Run a scan first.";
export const NO_TIDY_DIFF_INFO = "ModBear: go.mod is tidy — there is no tidy diff to show.";
export const NO_ADVISORY_INFO = "ModBear: No vulnerability findings available yet. Run a scan first.";

export async function requireTrustedWorkspace(): Promise<boolean> {
  if (vscode.workspace.isTrusted) return true;
  await vscode.window.showWarningMessage(TRUST_WARNING);
  return false;
}

interface DependencyDetailsQuickPickItem extends vscode.QuickPickItem {
  readonly status: DependencyStatus;
}

interface AdvisoryQuickPickItem extends vscode.QuickPickItem {
  readonly osvId: string;
}

function countModuleVulnerabilities(snapshot: ModuleAnalysisSnapshot, modulePath: string): number {
  return new Set(
    snapshot.vulnerabilities.findings
      .filter((finding) => finding.trace.some((frame) => frame.module === modulePath))
      .map((finding) => finding.osvId),
  ).size;
}

function formatDependencyDetail(status: DependencyStatus, vulnerabilityCount: number): string | undefined {
  const parts: string[] = [];
  if (status.deprecatedMessage) {
    parts.push(`Deprecated: ${status.deprecatedMessage}`);
  }
  if (status.retractionRationales.length > 0) {
    parts.push(`Retracted (${status.retractionRationales.length})`);
  }
  if (vulnerabilityCount > 0) {
    parts.push(`${vulnerabilityCount} ${vulnerabilityCount === 1 ? "vulnerability" : "vulnerabilities"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildDependencyQuickPickItems(snapshot: ModuleAnalysisSnapshot): DependencyDetailsQuickPickItem[] {
  return snapshot.dependencies.map((status) => {
    const detail = formatDependencyDetail(status, countModuleVulnerabilities(snapshot, status.modulePath));
    const base = { label: status.modulePath, ...(detail ? { detail } : {}), status };
    if (!status.availableVersion) return base;
    const kind = status.updateKind ?? "unknown";
    return { ...base, description: `${status.installedVersion} → ${status.availableVersion} (${kind})` };
  });
}

function buildAdvisoryQuickPickItems(snapshot: ModuleAnalysisSnapshot): AdvisoryQuickPickItem[] {
  const items = new Map<string, AdvisoryQuickPickItem>();
  for (const finding of snapshot.vulnerabilities.findings) {
    if (items.has(finding.osvId)) continue;
    const base: AdvisoryQuickPickItem = {
      label: finding.osvId,
      detail: `classification: ${finding.classification}`,
      osvId: finding.osvId,
    };
    const item = finding.fixedVersion ? { ...base, description: `fixed in ${finding.fixedVersion}` } : base;
    items.set(finding.osvId, item);
  }
  return [...items.values()];
}

async function openDetailsDocument(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

interface DependencySelection {
  readonly module: ModuleContext;
  readonly snapshot: ModuleAnalysisSnapshot;
  readonly status: DependencyStatus;
}

async function selectDependency(context: DetailCommandContext): Promise<DependencySelection | undefined> {
  const module = context.getActiveModule();
  const snapshot = module ? context.getSnapshot(module.id) : undefined;
  if (!snapshot || snapshot.dependencies.length === 0) {
    void vscode.window.showInformationMessage(NO_SNAPSHOT_INFO);
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(buildDependencyQuickPickItems(snapshot), {
    title: "ModBear: Dependency Details",
    placeHolder: "Select a dependency",
  });
  if (!selected || !module) return undefined;
  return { module, snapshot, status: selected.status };
}

export interface DetailCommandContext {
  readonly getActiveModule: () => ModuleContext | undefined;
  readonly getSnapshot: (moduleId: string) => ModuleAnalysisSnapshot | undefined;
  readonly detailsProvider: DetailsDocumentProvider;
}

export type ExplainRunner = (module: ModuleContext, modulePath: string, signal: AbortSignal) => Promise<string>;

export function createShowDetailsHandler(context: DetailCommandContext): () => Promise<void> {
  return async () => {
    if (!(await requireTrustedWorkspace())) return;
    const selection = await selectDependency(context);
    if (!selection) return;
    const uri = context.detailsProvider.set(
      "dependency",
      selection.status.modulePath,
      buildDependencyDetailsContent(selection.status, selection.snapshot.vulnerabilities),
    );
    await openDetailsDocument(uri);
  };
}

export function createExplainDependencyHandler(
  context: DetailCommandContext,
  runExplain: ExplainRunner,
): () => Promise<void> {
  return async () => {
    if (!(await requireTrustedWorkspace())) return;
    const selection = await selectDependency(context);
    if (!selection) return;
    try {
      const explanation = await runExplain(selection.module, selection.status.modulePath, new AbortController().signal);
      const uri = context.detailsProvider.set(
        "why",
        selection.status.modulePath,
        buildWhyDetailsContent(selection.status.modulePath, explanation),
      );
      await openDetailsDocument(uri);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`ModBear: Could not explain ${selection.status.modulePath}: ${detail}`);
    }
  };
}

export function createOpenAdvisoryHandler(
  context: DetailCommandContext,
  buildLink: (osvId: string) => string = buildAdvisoryLink,
): () => Promise<void> {
  return async () => {
    if (!(await requireTrustedWorkspace())) return;
    const module = context.getActiveModule();
    const snapshot = module ? context.getSnapshot(module.id) : undefined;
    const items =
      snapshot && snapshot.vulnerabilities.state === "complete" ? buildAdvisoryQuickPickItems(snapshot) : [];
    if (items.length === 0) {
      void vscode.window.showInformationMessage(NO_ADVISORY_INFO);
      return;
    }
    const selected = await vscode.window.showQuickPick(items, {
      title: "ModBear: Vulnerability Advisories",
      placeHolder: "Select an advisory to open",
    });
    if (!selected) return;
    try {
      const uri = validateAdvisoryUri(buildLink(selected.osvId));
      await vscode.env.openExternal(uri);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`ModBear: Could not open vulnerability advisory. ${detail}`);
    }
  };
}

export function createShowTidyDiffHandler(context: DetailCommandContext): () => Promise<void> {
  return async () => {
    if (!(await requireTrustedWorkspace())) return;
    const module = context.getActiveModule();
    const snapshot = module ? context.getSnapshot(module.id) : undefined;
    if (!snapshot || !snapshot.tidy) {
      void vscode.window.showInformationMessage(NO_TIDY_ANALYSIS_INFO);
      return;
    }
    const diff = snapshot.tidy.state === "complete" && !snapshot.tidy.consistent ? snapshot.tidy.diff : undefined;
    if (!diff) {
      void vscode.window.showInformationMessage(NO_TIDY_DIFF_INFO);
      return;
    }
    const uri = context.detailsProvider.set("tidy-diff", snapshot.moduleId, buildTidyDiffContent(diff));
    await openDetailsDocument(uri);
  };
}
