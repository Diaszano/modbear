import * as vscode from "vscode";
import type { ReplacementStatus } from "../domain/analysis";
import type { GoModReplacement } from "../domain/dependency";

export function mapReplacementDiagnostics(
  replacement: GoModReplacement,
  status: ReplacementStatus,
): readonly vscode.Diagnostic[] {
  if (!status.local || status.exists !== false) return [];
  const range = new vscode.Range(
    replacement.range.start.line,
    replacement.range.start.character,
    replacement.range.end.line,
    replacement.range.end.character,
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    `Local replacement target does not exist: ${status.targetPath}`,
    vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = "modbear";
  diagnostic.code = "missing-local-replacement";
  return [diagnostic];
}
