import * as vscode from "vscode";
import { DEFAULTS } from "./defaults";
import type { LogLevel } from "../logging/logger";

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly goPath: string;
  readonly onOpen: boolean;
  readonly onSave: boolean;
  readonly updateTtlMinutes: number;
  readonly timeoutSeconds: number;
  readonly govulncheckPath: string;
  readonly vulnerabilityEnabled: boolean;
  readonly vulnerabilityTimeoutSeconds: number;
  readonly updateSeverity: "none" | "information" | "warning";
  readonly maxConcurrentModules: number;
  readonly logLevel: LogLevel;
}

function isLogLevel(value: unknown): value is LogLevel {
  return value === "error" || value === "warn" || value === "info" || value === "debug";
}

export function readConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("modBear", resource);
  const configuredLogLevel = config.get<unknown>("output.logLevel", DEFAULTS.logLevel);
  return {
    enabled: config.get("enabled", DEFAULTS.enabled),
    goPath: config.get("go.path", DEFAULTS.goPath),
    onOpen: config.get("scan.onOpen", DEFAULTS.onOpen),
    onSave: config.get("scan.onSave", DEFAULTS.onSave),
    updateTtlMinutes: config.get("scan.updateTtlMinutes", DEFAULTS.updateTtlMinutes),
    timeoutSeconds: config.get("scan.timeoutSeconds", DEFAULTS.timeoutSeconds),
    govulncheckPath: config.get("govulncheck.path", DEFAULTS.govulncheckPath),
    vulnerabilityEnabled: config.get("vulnerability.enabled", DEFAULTS.vulnerabilityEnabled),
    vulnerabilityTimeoutSeconds: config.get("vulnerability.timeoutSeconds", DEFAULTS.vulnerabilityTimeoutSeconds),
    updateSeverity: config.get("diagnostics.updateSeverity", DEFAULTS.updateSeverity),
    maxConcurrentModules: config.get("scan.maxConcurrentModules", DEFAULTS.maxConcurrentModules),
    logLevel: isLogLevel(configuredLogLevel) ? configuredLogLevel : DEFAULTS.logLevel,
  };
}
