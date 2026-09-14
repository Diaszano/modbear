import * as vscode from "vscode";
import type { TidyAnalysis } from "../domain/analysis";
import type { ParsedGoMod } from "../domain/dependency";

export function mapTidyDiagnostic(parsed: ParsedGoMod, tidy: TidyAnalysis | undefined): vscode.Diagnostic | undefined {
  if (!parsed.module || !tidy || tidy.state !== "complete" || tidy.consistent || !tidy.diff) return undefined;
  const range = parsed.module.range;
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character),
    "Module is not tidy: go.mod differs from the output of go mod tidy -diff.",
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = "modbear";
  diagnostic.code = "tidy-diff";
  return diagnostic;
}
