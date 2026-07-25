import type { DependencyStatus } from "../domain/analysis";
import type { VulnerabilityFinding } from "../domain/vulnerability";

export function buildInlayLabel(
  status: DependencyStatus,
  showKind: boolean,
  findings: readonly VulnerabilityFinding[] = []
): string | undefined {
  const reachable = findings.filter((finding) => finding.classification === "reachable");
  const fixed = reachable.find((finding) => finding.fixedVersion);
  if (fixed?.fixedVersion) return `🛡 fixed in ${fixed.fixedVersion}`;
  if (reachable.length > 0) return "🛡 vulnerable · no fix";
  if (status.retractionRationales.length > 0) {
    return status.availableVersion ? `⚠ retracted · → ${status.availableVersion}` : "⚠ retracted";
  }
  if (status.deprecatedMessage) return "⚠ deprecated";
  if (status.availableVersion) {
    const kind = showKind && status.updateKind ? ` · ${status.updateKind}` : "";
    return `→ ${status.availableVersion}${kind}`;
  }
  if (status.replacement?.local) return "↪ local replacement";
  return undefined;
}
