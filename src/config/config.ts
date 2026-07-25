import * as vscode from "vscode";
import { DEFAULTS } from "./defaults";
import type { LogLevel } from "../logging/logger";

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly goPath: string;
  readonly onOpen: boolean;
  readonly onSave: boolean;
  readonly updateTtlMinutes: number;
  readonly vulnerabilityTtlMinutes: number;
  readonly tidyTtlMinutes: number;
  readonly timeoutSeconds: number;
  readonly govulncheckPath: string;
  readonly vulnerabilityEnabled: boolean;
  readonly vulnerabilityTimeoutSeconds: number;
  readonly tidyEnabled: boolean;
  readonly vulnerabilityIncludeTests: boolean;
  readonly vulnerabilityBuildTags: readonly string[];
  readonly vulnerabilityDatabase: string;
  readonly updateSeverity: "none" | "information" | "warning";
  readonly importedVulnerabilitySeverity: "none" | "information" | "warning";
  readonly maxConcurrentModules: number;
  readonly logLevel: LogLevel;
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === "error" || value === "warn" || value === "info" || value === "debug";
}

function isSeverity(value: unknown): value is "none" | "information" | "warning" {
  return value === "none" || value === "information" || value === "warning";
}

function isBuildTag(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value);
}

function isSafeBuildTags(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 32 && value.every(isBuildTag) && new Set(value).size === value.length;
}

function isSafeDatabase(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function readConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("modBear", resource);
  const configuredLogLevel = config.get<unknown>("output.logLevel", DEFAULTS.logLevel);
  const configuredBuildTags = config.get<unknown>("vulnerability.buildTags", DEFAULTS.vulnerabilityBuildTags);
  const configuredDatabase = config.get<unknown>("vulnerability.database", DEFAULTS.vulnerabilityDatabase);
  const configuredImportedSeverity = config.get<unknown>("diagnostics.importedVulnerabilitySeverity", DEFAULTS.importedVulnerabilitySeverity);
  return {
    enabled: config.get("enabled", DEFAULTS.enabled),
    goPath: config.get("go.path", DEFAULTS.goPath),
    onOpen: config.get("scan.onOpen", DEFAULTS.onOpen),
    onSave: config.get("scan.onSave", DEFAULTS.onSave),
    updateTtlMinutes: config.get("scan.updateTtlMinutes", DEFAULTS.updateTtlMinutes),
    vulnerabilityTtlMinutes: config.get("scan.vulnerabilityTtlMinutes", DEFAULTS.vulnerabilityTtlMinutes),
    tidyTtlMinutes: config.get("scan.tidyTtlMinutes", DEFAULTS.tidyTtlMinutes),
    timeoutSeconds: config.get("scan.timeoutSeconds", DEFAULTS.timeoutSeconds),
    govulncheckPath: config.get("govulncheck.path", DEFAULTS.govulncheckPath),
    vulnerabilityEnabled: config.get("vulnerability.enabled", DEFAULTS.vulnerabilityEnabled),
    vulnerabilityTimeoutSeconds: config.get("vulnerability.timeoutSeconds", DEFAULTS.vulnerabilityTimeoutSeconds),
    tidyEnabled: config.get("tidy.enabled", DEFAULTS.tidyEnabled),
    vulnerabilityIncludeTests: config.get("vulnerability.includeTests", DEFAULTS.vulnerabilityIncludeTests),
    vulnerabilityBuildTags: isSafeBuildTags(configuredBuildTags)
      ? configuredBuildTags
      : DEFAULTS.vulnerabilityBuildTags,
    vulnerabilityDatabase: isSafeDatabase(configuredDatabase) ? configuredDatabase : DEFAULTS.vulnerabilityDatabase,
    updateSeverity: isSeverity(config.get<unknown>("diagnostics.updateSeverity", DEFAULTS.updateSeverity))
      ? config.get("diagnostics.updateSeverity", DEFAULTS.updateSeverity)
      : DEFAULTS.updateSeverity,
    importedVulnerabilitySeverity: isSeverity(configuredImportedSeverity)
      ? configuredImportedSeverity
      : DEFAULTS.importedVulnerabilitySeverity,
    maxConcurrentModules: config.get("scan.maxConcurrentModules", DEFAULTS.maxConcurrentModules),
    logLevel: isLogLevel(configuredLogLevel) ? configuredLogLevel : DEFAULTS.logLevel
  };
}
