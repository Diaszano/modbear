import type { UpdateKind } from "./dependency";

export type AnalysisErrorCode =
  | "tool-not-found"
  | "permission-denied"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "invalid-json"
  | "unsupported-protocol"
  | "module-resolution"
  | "network"
  | "workspace-untrusted"
  | "unknown";

export interface AnalysisError {
  readonly code: AnalysisErrorCode;
  readonly message: string;
  readonly detail?: string;
}

export interface ReplacementStatus {
  readonly sourcePath: string;
  readonly sourceVersion?: string;
  readonly targetPath: string;
  readonly targetVersion?: string;
  readonly local: boolean;
  readonly exists?: boolean;
}

export interface DependencyStatus {
  readonly modulePath: string;
  readonly installedVersion: string;
  readonly availableVersion?: string;
  readonly updateKind?: UpdateKind;
  readonly deprecatedMessage?: string;
  readonly retractionRationales: readonly string[];
  readonly replacement?: ReplacementStatus;
  readonly errors: readonly AnalysisError[];
}

export type AnalyzerState = "idle" | "running" | "complete" | "partial" | "failed" | "unavailable";

export interface ModuleAnalysisSnapshot {
  readonly moduleId: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly stale: boolean;
  readonly updateState: AnalyzerState;
  readonly dependencies: readonly DependencyStatus[];
  readonly replacements: readonly ReplacementStatus[];
  readonly errors: readonly AnalysisError[];
}

export interface SnapshotMetrics {
  readonly updates: number;
  readonly warnings: number;
}

export function getSnapshotMetrics(snapshot: ModuleAnalysisSnapshot): SnapshotMetrics {
  let updates = 0;
  let warnings = 0;
  for (const dep of snapshot.dependencies) {
    if (dep.availableVersion) {
      updates++;
    }
    if (dep.deprecatedMessage || dep.retractionRationales.length > 0 || dep.errors.length > 0) {
      warnings++;
    }
  }
  return { updates, warnings };
}



