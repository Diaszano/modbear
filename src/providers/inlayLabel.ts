import type { DependencyStatus } from "../domain/analysis";

export function buildInlayLabel(status: DependencyStatus, showKind: boolean): string | undefined {
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
