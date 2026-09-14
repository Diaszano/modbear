import type { DependencyStatus } from "../domain/analysis";
import type { VulnerabilityAnalysis } from "../domain/vulnerability";

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|>]/g, "\\$&");
}

export function sanitizeOsvId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 100);
  return cleaned.length > 0 ? cleaned : "unknown-advisory";
}

export function buildAdvisoryLink(osvId: string): string {
  return `https://pkg.go.dev/vuln/${encodeURIComponent(sanitizeOsvId(osvId))}`;
}

export function buildDependencyDetailsContent(
  status: DependencyStatus,
  vulnerabilities: VulnerabilityAnalysis,
): string {
  const lines: string[] = [`# ${status.modulePath}`, ""];
  lines.push(`Installed: \`${status.installedVersion}\``);
  if (status.availableVersion) {
    lines.push(`Available: \`${status.availableVersion}\` (${status.updateKind ?? "unknown"})`);
  }
  lines.push("");
  if (status.deprecatedMessage) {
    lines.push(`**Deprecated:** ${escapeMarkdown(status.deprecatedMessage)}`, "");
  }
  for (const rationale of status.retractionRationales) {
    lines.push(`**Retracted:** ${escapeMarkdown(rationale)}`, "");
  }

  const findings =
    vulnerabilities.state === "complete"
      ? vulnerabilities.findings.filter((finding) => finding.trace.some((frame) => frame.module === status.modulePath))
      : [];
  lines.push("## Vulnerabilities", "");
  if (findings.length === 0) {
    lines.push("No vulnerability findings recorded for this dependency.", "");
  }
  for (const finding of findings) {
    const advisory = vulnerabilities.advisories[finding.osvId];
    lines.push(
      `- **${sanitizeOsvId(finding.osvId)}** (classification: \`${finding.classification}\`)` +
        (finding.fixedVersion ? ` — fixed in \`${finding.fixedVersion}\`` : ""),
    );
    if (advisory?.summary) {
      lines.push(`  ${escapeMarkdown(advisory.summary)}`);
    }
    if (advisory?.details) {
      lines.push("", `  ${escapeMarkdown(advisory.details)}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildWhyDetailsContent(modulePath: string, explanation: string): string {
  return `# Why is ${modulePath} needed?\n\n\`\`\`\n${explanation.trim()}\n\`\`\`\n`;
}

export function buildTidyDiffContent(diff: string): string {
  return `# go mod tidy -diff\n\n\`\`\`diff\n${diff.trimEnd()}\n\`\`\`\n`;
}
