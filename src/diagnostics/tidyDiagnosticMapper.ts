import * as vscode from "vscode";
import type { TidyAnalysis } from "../domain/analysis";
import type { ParsedGoMod } from "../domain/dependency";

export function mapTidyDiagnostic(parsed: ParsedGoMod, tidy: TidyAnalysis): vscode.Diagnostic | undefined {
  if (tidy.state !== "complete" || tidy.consistent || !parsed.module) {
    return undefined;
  }

  const range = new vscode.Range(
    parsed.module.range.start.line,
    parsed.module.range.start.character,
    parsed.module.range.end.line,
    parsed.module.range.end.character
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    "go.mod differs from the result of go mod tidy.",
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "modbear";
  diagnostic.code = "tidy-diff";
  return diagnostic;
}
