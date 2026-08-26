import * as vscode from "vscode";
import type { ToolchainAnalysis } from "../domain/analysis";
import type { ParsedGoMod } from "../domain/dependency";
import type { TextRange } from "../domain/module";
import { compareToolchainVersions, parseToolchainVersion } from "../parsers/goToolchainVersionParser";

function toRange(range: TextRange): vscode.Range {
  return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}

function createDiagnostic(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity, code: string) {
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = "modbear";
  diagnostic.code = code;
  return diagnostic;
}

export function mapToolchainDiagnostics(
  parsed: ParsedGoMod,
  analysis: ToolchainAnalysis | undefined,
): vscode.Diagnostic[] {
  if (!analysis) return [];

  const installed = parseToolchainVersion(analysis.installed ?? "");
  if (analysis.state !== "complete" || !installed) {
    if (!parsed.module) return [];
    return [
      createDiagnostic(
        toRange(parsed.module.range),
        "ModBear could not determine the installed Go version, so toolchain compatibility is unverified.",
        vscode.DiagnosticSeverity.Warning,
        "toolchain-unavailable",
      ),
    ];
  }

  const diagnostics: vscode.Diagnostic[] = [];

  if (parsed.go) {
    const required = parseToolchainVersion(parsed.go.version);
    if (!required || compareToolchainVersions(installed, required) < 0) {
      const message = required
        ? `Installed Go ${analysis.installed} does not satisfy the go ${parsed.go.version} requirement.`
        : `go.mod declares an invalid go directive (${parsed.go.version}).`;
      diagnostics.push(
        createDiagnostic(toRange(parsed.go.range), message, vscode.DiagnosticSeverity.Error, "go-version"),
      );
    }
  }

  if (parsed.toolchain) {
    const suggested = parseToolchainVersion(parsed.toolchain.version);
    if (!suggested || compareToolchainVersions(installed, suggested) < 0) {
      const message = suggested
        ? `The suggested toolchain ${parsed.toolchain.version} is newer than the installed Go ${analysis.installed}.`
        : `go.mod declares an invalid toolchain directive (${parsed.toolchain.version}).`;
      diagnostics.push(
        createDiagnostic(
          toRange(parsed.toolchain.range),
          message,
          vscode.DiagnosticSeverity.Warning,
          "toolchain-version",
        ),
      );
    }
  }

  return diagnostics;
}
