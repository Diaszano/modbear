import * as vscode from "vscode";
import type { DependencyStatus } from "../domain/analysis";
import type { GoModRequirement } from "../domain/dependency";

export function mapUpdateDiagnostics(
  requirement: GoModRequirement,
  status: DependencyStatus,
  updateSeverity: "none" | "information" | "warning"
): readonly vscode.Diagnostic[] {
  const range = new vscode.Range(
    requirement.versionRange.start.line,
    requirement.versionRange.start.character,
    requirement.versionRange.end.line,
    requirement.versionRange.end.character
  );
  const diagnostics: vscode.Diagnostic[] = [];
  const add = (message: string, severity: vscode.DiagnosticSeverity, code: string): void => {
    const diagnostic = new vscode.Diagnostic(range, message, severity);
    diagnostic.source = "modbear";
    diagnostic.code = code;
    diagnostics.push(diagnostic);
  };
  if (status.retractionRationales.length > 0) {
    add(`Selected version is retracted: ${status.retractionRationales.join("; ")}`, vscode.DiagnosticSeverity.Warning, "retracted");
  }
  if (status.deprecatedMessage) {
    add(`Module is deprecated: ${status.deprecatedMessage}`, vscode.DiagnosticSeverity.Warning, "deprecated");
  }
  if (status.availableVersion && updateSeverity !== "none") {
    add(
      `${status.availableVersion} is available (${status.updateKind ?? "unknown"})`,
      updateSeverity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
      "update-available"
    );
  }
  return diagnostics;
}
