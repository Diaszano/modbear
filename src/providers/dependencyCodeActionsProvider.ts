import * as vscode from "vscode";
import type { ModuleContext, TextRange } from "../domain/module";
import type { ScanCoordinator } from "../orchestration/scanCoordinator";
import { GoModDocumentCache } from "../parsers/goModDocumentCache";

export class DependencyCodeActionsProvider implements vscode.CodeActionProvider, vscode.Disposable {
  public constructor(
    private readonly coordinator: ScanCoordinator,
    private readonly resolveModule: (uri: vscode.Uri) => ModuleContext | undefined,
    private readonly cache: GoModDocumentCache
  ) {}

  public provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const module = this.resolveModule(document.uri);
    const snapshot = module ? this.coordinator.getSnapshot(module.id) : undefined;
    if (!snapshot) return [];

    const parsed = this.cache.get(document);
    const actions: vscode.CodeAction[] = [];
    const requirement = parsed.requirements.find((item) => overlaps(range, item.versionRange));
    if (requirement && snapshot.dependencies.some((item) => item.modulePath === requirement.modulePath)) {
      actions.push(commandAction(
        "ModBear: Explain Dependency",
        "modBear.explainDependency",
        { modulePath: requirement.modulePath }
      ));
      for (const finding of snapshot.vulnerabilities.findings) {
        if (!finding.trace.some((frame) => frame.module === requirement.modulePath)) continue;
        actions.push(commandAction(
          "ModBear: Show Vulnerability Details",
          "modBear.showDetails",
          { modulePath: requirement.modulePath, osvId: finding.osvId }
        ));
        actions.push(commandAction(
          "ModBear: Open Vulnerability Advisory",
          "modBear.openAdvisory",
          { url: `https://osv.dev/vulnerability/${encodeURIComponent(finding.osvId)}` }
        ));
      }
    }

    if (snapshot.tidy.diff && parsed.module && overlaps(range, parsed.module.range)) {
      actions.push(commandAction("ModBear: Show Tidy Diff", "modBear.showTidyDiff"));
    }
    return actions;
  }

  public dispose(): void {}
}

function commandAction(title: string, command: string, argument?: object): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.command = {
    command,
    title,
    ...(argument ? { arguments: [argument] } : {})
  };
  return action;
}

function overlaps(range: vscode.Range, target: TextRange): boolean {
  const targetRange = new vscode.Range(target.start.line, target.start.character, target.end.line, target.end.character);
  return range.intersection(targetRange) !== undefined;
}
