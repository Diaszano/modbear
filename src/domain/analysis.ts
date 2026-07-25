import type { UpdateKind } from "./dependency";
import type { VulnerabilityAnalysis } from "./vulnerability";
import { ProcessExecutionError } from "../execution/processRunner";

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

export interface TidyAnalysis {
  readonly state: AnalyzerState;
  readonly consistent: boolean;
  readonly diff?: string;
  readonly errors: readonly AnalysisError[];
  readonly scannedAt?: string;
}

export interface ToolchainAnalysis {
  readonly state: AnalyzerState;
  readonly installed?: string;
  readonly required?: string;
  readonly suggested?: string;
  readonly errors: readonly AnalysisError[];
  readonly scannedAt?: string;
}

export interface ModuleAnalysisSnapshot {
  readonly moduleId: string;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly stale: boolean;
  readonly updateState: AnalyzerState;
  readonly dependencies: readonly DependencyStatus[];
  readonly replacements: readonly ReplacementStatus[];
  readonly vulnerabilities: VulnerabilityAnalysis;
  readonly tidy: TidyAnalysis;
  readonly toolchain: ToolchainAnalysis;
  readonly errors: readonly AnalysisError[];
}

export interface SnapshotMetrics {
  readonly updates: number;
  readonly warnings: number;
}

export function classifyAnalysisError(error: unknown): AnalysisErrorCode {
  if (error instanceof ProcessExecutionError) {
    switch (error.kind) {
      case "spawn": {
        const code = getErrorCode(error.cause);
        return code === "EACCES" || code === "EPERM" ? "permission-denied" : "tool-not-found";
      }
      case "timeout":
        return "timeout";
      case "cancelled":
        return "cancelled";
      case "output-limit":
        return "output-limit";
      case "exit-nonzero":
        return "unknown";
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/network|econn|enotfound|eai_again/.test(message)) return "network";
  if (/permission denied|eacces|eperm/.test(message)) return "permission-denied";
  if (/not found|enoent/.test(message)) return "tool-not-found";
  return "unknown";
}

function getErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
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
