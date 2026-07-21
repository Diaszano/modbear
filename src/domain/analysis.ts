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
