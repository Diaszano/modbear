import * as vscode from "vscode";
import { parseGoModPositions } from "../parsers/goModPositionParser";
import { buildInlayLabel } from "./inlayLabel";
import type { ScanCoordinator } from "../orchestration/scanCoordinator";
import type { ModuleContext } from "../domain/module";

export class DependencyInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this.changeEmitter.event;

  public constructor(
    private readonly coordinator: ScanCoordinator,
    private readonly resolveModule: (uri: vscode.Uri) => ModuleContext | undefined,
    private readonly requestScan: (module: ModuleContext) => void
  ) {}

  public refresh(): void {
    this.changeEmitter.fire();
  }

  public provideInlayHints(document: vscode.TextDocument): vscode.InlayHint[] {
    const module = this.resolveModule(document.uri);
    if (!module) return [];
    const snapshot = this.coordinator.getSnapshot(module.id);
    if (!snapshot) {
      this.requestScan(module);
      return [];
    }

    const parsed = parseGoModPositions(document.getText());
    const byPath = new Map(snapshot.dependencies.map((status) => [status.modulePath, status]));
    const config = vscode.workspace.getConfiguration("modBear", document.uri);
    if (!config.get("inlayHints.enabled", true)) return [];
    const showIndirect = config.get("inlayHints.showIndirect", true);
    const showUpToDate = config.get("inlayHints.showUpToDate", false);
    const showKind = config.get("inlayHints.showUpdateKind", true);

    return parsed.requirements.flatMap((requirement) => {
      if (requirement.indirect && !showIndirect) return [];
      const status = byPath.get(requirement.modulePath);
      const label = status ? buildInlayLabel(status, showKind) : undefined;
      const finalLabel = label ?? (showUpToDate && status ? "✓ current" : undefined);
      if (!finalLabel) return [];
      const hint = new vscode.InlayHint(
        new vscode.Position(requirement.versionRange.end.line, requirement.versionRange.end.character),
        finalLabel,
        vscode.InlayHintKind.Type
      );
      hint.paddingLeft = true;
      hint.tooltip = new vscode.MarkdownString(`**${requirement.modulePath}**\n\nInstalled: \`${requirement.version}\`\n\n${finalLabel}`);
      return [hint];
    });
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}
