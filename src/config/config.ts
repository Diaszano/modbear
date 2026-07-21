import * as vscode from "vscode";
import { DEFAULTS } from "./defaults";

export interface ExtensionConfig {
  readonly enabled: boolean;
  readonly goPath: string;
  readonly onOpen: boolean;
  readonly onSave: boolean;
  readonly updateTtlMinutes: number;
  readonly timeoutSeconds: number;
  readonly updateSeverity: "none" | "information" | "warning";
}

export function readConfig(resource?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("modBear", resource);
  return {
    enabled: config.get("enabled", DEFAULTS.enabled),
    goPath: config.get("go.path", DEFAULTS.goPath),
    onOpen: config.get("scan.onOpen", DEFAULTS.onOpen),
    onSave: config.get("scan.onSave", DEFAULTS.onSave),
    updateTtlMinutes: config.get("scan.updateTtlMinutes", DEFAULTS.updateTtlMinutes),
    timeoutSeconds: config.get("scan.timeoutSeconds", DEFAULTS.timeoutSeconds),
    updateSeverity: config.get("diagnostics.updateSeverity", DEFAULTS.updateSeverity)
  };
}
