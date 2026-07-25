import * as vscode from "vscode";
import type { ToolchainAnalysis } from "../domain/analysis";
import type { ParsedGoMod } from "../domain/dependency";
import { compareToolchainVersions, parseToolchainVersion } from "../parsers/goToolchainVersionParser";

export function mapToolchainDiagnostics(
  parsed: ParsedGoMod,
  analysis: ToolchainAnalysis
): readonly vscode.Diagnostic[] {
  const malformed = malformedDirectiveDiagnostics(parsed);
  if (malformed.length > 0) return malformed;
  if (analysis.state === "failed" || analysis.state === "unavailable") {
    return parsed.module ? [diagnostic(parsed.module.range, "Go toolchain analysis is unavailable.", vscode.DiagnosticSeverity.Error, "toolchain-unavailable")] : [];
  }
  if (analysis.state !== "complete") return [];

  const installed = analysis.installed && parseToolchainVersion(analysis.installed);
  if (!installed) {
    return parsed.module ? [diagnostic(parsed.module.range, "Go toolchain analysis is unavailable.", vscode.DiagnosticSeverity.Error, "toolchain-unavailable")] : [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const required = analysis.required && parseToolchainVersion(analysis.required);
  if (required && parsed.go && compareToolchainVersions(installed, required) < 0) {
    diagnostics.push(diagnostic(
      parsed.go.range,
      `Installed Go version ${analysis.installed} is below required version ${analysis.required}.`,
      vscode.DiagnosticSeverity.Error,
      "go-version"
    ));
  }
  const suggested = analysis.suggested && parseToolchainVersion(analysis.suggested);
  if (suggested && parsed.toolchain && compareToolchainVersions(installed, suggested) < 0) {
    diagnostics.push(diagnostic(
      parsed.toolchain.range,
      `Installed Go version ${analysis.installed} is below suggested toolchain ${analysis.suggested}.`,
      vscode.DiagnosticSeverity.Warning,
      "toolchain-version"
    ));
  }
  return diagnostics;
}

function malformedDirectiveDiagnostics(parsed: ParsedGoMod): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  if (parsed.go && !parseToolchainVersion(parsed.go.version)) {
    diagnostics.push(diagnostic(
      parsed.go.range,
      `Invalid Go version ${parsed.go.version}.`,
      vscode.DiagnosticSeverity.Warning,
      "go-version"
    ));
  }
  if (parsed.toolchain && !parseToolchainVersion(parsed.toolchain.version)) {
    diagnostics.push(diagnostic(
      parsed.toolchain.range,
      `Invalid toolchain version ${parsed.toolchain.version}.`,
      vscode.DiagnosticSeverity.Warning,
      "toolchain-version"
    ));
  }
  return diagnostics;
}

function diagnostic(
  range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } },
  message: string,
  severity: vscode.DiagnosticSeverity,
  code: string
): vscode.Diagnostic {
  const item = new vscode.Diagnostic(
    new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character),
    message,
    severity
  );
  item.source = "modbear";
  item.code = code;
  return item;
}
