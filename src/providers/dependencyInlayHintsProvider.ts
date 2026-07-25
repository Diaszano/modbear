import * as vscode from "vscode";
import { GoModDocumentCache } from "../parsers/goModDocumentCache";
import { buildInlayLabel } from "./inlayLabel";
import type { ScanCoordinator } from "../orchestration/scanCoordinator";
import type { ModuleContext } from "../domain/module";
import {
  PREPARE_UPDATE_COMMAND_ID,
  type PrepareUpdateArgs
} from "./terminalUpdateManager";

export class DependencyInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeInlayHints = this.changeEmitter.event;

  public constructor(
    private readonly coordinator: ScanCoordinator,
    private readonly resolveModule: (uri: vscode.Uri) => ModuleContext | undefined,
    private readonly requestScan: (module: ModuleContext) => void,
    private readonly cache: GoModDocumentCache
  ) {}

  public refresh(): void {
    this.changeEmitter.fire();
  }

  public provideInlayHints(document: vscode.TextDocument): vscode.InlayHint[] {
    const config = vscode.workspace.getConfiguration("modBear", document.uri);
    if (!config.get("enabled", true)) return [];

    const module = this.resolveModule(document.uri);
    if (!module) return [];
    const snapshot = this.coordinator.getSnapshot(module.id);
    if (!snapshot) {
      this.requestScan(module);
      return [];
    }

    const parsed = this.cache.get(document);
    const byPath = new Map(snapshot.dependencies.map((status) => [status.modulePath, status]));
    const findingsByModulePath = new Map<string, typeof snapshot.vulnerabilities.findings>();
    for (const finding of snapshot.vulnerabilities.findings) {
      for (const frame of finding.trace) {
        const findings = findingsByModulePath.get(frame.module) ?? [];
        findingsByModulePath.set(frame.module, [...findings, finding]);
      }
    }
    if (!config.get("inlayHints.enabled", true)) return [];
    const showIndirect = config.get("inlayHints.showIndirect", true);
    const showUpToDate = config.get("inlayHints.showUpToDate", false);
    const showKind = config.get("inlayHints.showUpdateKind", true);

    return parsed.requirements.flatMap((requirement) => {
      if (requirement.indirect && !showIndirect) return [];
      const status = byPath.get(requirement.modulePath);
      const label = status ? buildInlayLabel(status, showKind, findingsByModulePath.get(requirement.modulePath)) : undefined;
      const finalLabel = label ?? (showUpToDate && status ? "✓ current" : undefined);
      if (!finalLabel) return [];
      let hintLabel: string | vscode.InlayHintLabelPart[] = finalLabel;
      if (status?.availableVersion && vscode.workspace.isTrusted) {
        const actionArgs: PrepareUpdateArgs = {
          moduleRoot: module.moduleRoot,
          modulePath: requirement.modulePath,
          version: status.availableVersion
        };
        const terminalPart = new vscode.InlayHintLabelPart("$(terminal)");
        terminalPart.tooltip = "Prepare the suggested go get command in the terminal";
        terminalPart.command = {
          command: PREPARE_UPDATE_COMMAND_ID,
          title: "Prepare Update in Terminal",
          arguments: [actionArgs]
        };
        const informationPart = new vscode.InlayHintLabelPart(` ${finalLabel}`);
        hintLabel = [terminalPart, informationPart];
      }
      const hint = new vscode.InlayHint(
        new vscode.Position(requirement.versionRange.end.line, requirement.versionRange.end.character),
        hintLabel,
        vscode.InlayHintKind.Type
      );
      hint.paddingLeft = true;
      hint.tooltip = new vscode.MarkdownString(
        `**${requirement.modulePath}**\n\nInstalled: \`${requirement.version}\`\n\n${finalLabel}`
      );
      return [hint];
    });
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }
}
