import * as vscode from "vscode";
import type { GoModDocumentCache } from "../parsers/goModDocumentCache";
import type { ScanCoordinator } from "../orchestration/scanCoordinator";
import type { ModuleContext } from "../domain/module";

export class DependencyHoverProvider implements vscode.HoverProvider {
  public constructor(
    private readonly coordinator: ScanCoordinator,
    private readonly resolveModule: (uri: vscode.Uri) => ModuleContext | undefined,
    private readonly cache: GoModDocumentCache,
  ) {}

  public provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const module = this.resolveModule(document.uri);
    const snapshot = module ? this.coordinator.getSnapshot(module.id) : undefined;
    if (!snapshot) return undefined;
    const requirement = this.cache
      .get(document)
      .requirements.find(
        (item) =>
          item.line === position.line &&
          position.character >= item.versionRange.start.character &&
          position.character <= item.versionRange.end.character,
      );
    if (!requirement) return undefined;
    const status = snapshot.dependencies.find((item) => item.modulePath === requirement.modulePath);
    if (!status) return undefined;

    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = false;
    markdown.appendMarkdown(`### ${status.modulePath}\n\n`);
    markdown.appendMarkdown(`Installed: \`${status.installedVersion}\`\n\n`);
    if (status.availableVersion)
      markdown.appendMarkdown(`Available: \`${status.availableVersion}\` (${status.updateKind ?? "unknown"})\n\n`);
    if (status.deprecatedMessage)
      markdown.appendMarkdown(`**Deprecated:** ${escapeMarkdown(status.deprecatedMessage)}\n\n`);
    for (const rationale of status.retractionRationales)
      markdown.appendMarkdown(`**Retracted:** ${escapeMarkdown(rationale)}\n\n`);

    if (snapshot.vulnerabilities.state === "unavailable") {
      markdown.appendMarkdown(`Vulnerability analysis unavailable\n\n`);
    } else if (snapshot.vulnerabilities.state === "complete") {
      const findings = snapshot.vulnerabilities.findings.filter((finding) =>
        finding.trace.some((frame) => frame.module === requirement.modulePath),
      );
      if (findings.length > 0) {
        markdown.appendMarkdown(`### Vulnerabilities\n\n`);
        for (const finding of findings) {
          const advisory = snapshot.vulnerabilities.advisories[finding.osvId];
          const title = advisory?.summary
            ? `**${finding.osvId}**: ${escapeMarkdown(advisory.summary)}`
            : `**${finding.osvId}**`;
          markdown.appendMarkdown(`- ${title} (classification: \`${finding.classification}\`)\n`);
          if (advisory?.details) {
            markdown.appendMarkdown(`  ${escapeMarkdown(advisory.details)}\n\n`);
          }
          if (finding.fixedVersion) {
            markdown.appendMarkdown(`  Fixed in: \`${finding.fixedVersion}\`\n\n`);
          }
        }
      }
    }

    if (status.availableVersion)
      markdown.appendCodeblock(`${["go", "get"].join(" ")} ${status.modulePath}@${status.availableVersion}`, "shell");
    markdown.appendMarkdown("Suggested commands are not executed by this extension.");
    return new vscode.Hover(markdown);
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
}
