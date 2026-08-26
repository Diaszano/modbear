import * as vscode from "vscode";
import { DEFAULTS } from "./defaults";
import type { ImportedVulnerabilitySeverity } from "../domain/analysis";
import type { LogLevel } from "../logging/logger";

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly goPath: string;
  readonly onOpen: boolean;
  readonly onSave: boolean;
  readonly updateTtlMinutes: number;
  readonly timeoutSeconds: number;
  readonly tidyEnabled: boolean;
  readonly tidyTtlMinutes: number;
  readonly vulnerabilityTtlMinutes: number;
  readonly govulncheckPath: string;
  readonly vulnerabilityEnabled: boolean;
  readonly vulnerabilityTimeoutSeconds: number;
  readonly vulnerabilityIncludeTests: boolean;
  readonly vulnerabilityBuildTags: readonly string[];
  readonly vulnerabilityDatabase: string;
  readonly importedVulnerabilitySeverity: ImportedVulnerabilitySeverity;
  readonly updateSeverity: "none" | "information" | "warning";
  readonly maxConcurrentModules: number;
  readonly logLevel: LogLevel;
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === "error" || value === "warn" || value === "info" || value === "debug";
}

function isImportedVulnerabilitySeverity(value: unknown): value is ImportedVulnerabilitySeverity {
  return value === "error" || value === "warning" || value === "information" || value === "none";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function readConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("modBear", resource);
  const configuredLogLevel = config.get<unknown>("output.logLevel", DEFAULTS.logLevel);
  const configuredSeverity = config.get<unknown>("diagnostics.importedVulnerabilitySeverity");
  const configuredBuildTags = config.get<unknown>("vulnerability.buildTags");
  return {
    enabled: config.get("enabled", DEFAULTS.enabled),
    goPath: config.get("go.path", DEFAULTS.goPath),
    onOpen: config.get("scan.onOpen", DEFAULTS.onOpen),
    onSave: config.get("scan.onSave", DEFAULTS.onSave),
    updateTtlMinutes: config.get("scan.updateTtlMinutes", DEFAULTS.updateTtlMinutes),
    timeoutSeconds: config.get("scan.timeoutSeconds", DEFAULTS.timeoutSeconds),
    tidyEnabled: config.get("tidy.enabled", DEFAULTS.tidyEnabled),
    tidyTtlMinutes: config.get("scan.tidyTtlMinutes", DEFAULTS.tidyTtlMinutes),
    vulnerabilityTtlMinutes: config.get("scan.vulnerabilityTtlMinutes", DEFAULTS.vulnerabilityTtlMinutes),
    govulncheckPath: config.get("govulncheck.path", DEFAULTS.govulncheckPath),
    vulnerabilityEnabled: config.get("vulnerability.enabled", DEFAULTS.vulnerabilityEnabled),
    vulnerabilityTimeoutSeconds: config.get("vulnerability.timeoutSeconds", DEFAULTS.vulnerabilityTimeoutSeconds),
    vulnerabilityIncludeTests: config.get("vulnerability.includeTests", DEFAULTS.vulnerabilityIncludeTests),
    vulnerabilityBuildTags: isStringArray(configuredBuildTags) ? configuredBuildTags : DEFAULTS.vulnerabilityBuildTags,
    vulnerabilityDatabase: config.get("vulnerability.database", DEFAULTS.vulnerabilityDatabase),
    importedVulnerabilitySeverity: isImportedVulnerabilitySeverity(configuredSeverity)
      ? configuredSeverity
      : DEFAULTS.importedVulnerabilitySeverity,
    updateSeverity: config.get("diagnostics.updateSeverity", DEFAULTS.updateSeverity),
    maxConcurrentModules: config.get("scan.maxConcurrentModules", DEFAULTS.maxConcurrentModules),
    logLevel: isLogLevel(configuredLogLevel) ? configuredLogLevel : DEFAULTS.logLevel,
  };
}
