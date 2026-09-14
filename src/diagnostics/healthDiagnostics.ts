import type * as vscode from "vscode";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ParsedGoMod } from "../domain/dependency";
import { mapReplacementDiagnostics } from "./replacementDiagnosticMapper";
import { mapTidyDiagnostic } from "./tidyDiagnosticMapper";
import { mapToolchainDiagnostics } from "./toolchainDiagnosticMapper";
import { mapUpdateDiagnostics } from "./updateDiagnosticMapper";
import { mapVulnerabilityDiagnostics } from "./vulnerabilityDiagnosticMapper";

export function mergeHealthDiagnostics(
  parsed: ParsedGoMod,
  snapshot: ModuleAnalysisSnapshot,
  updateSeverity: "none" | "information" | "warning",
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];

  const dependenciesByPath = new Map(snapshot.dependencies.map((status) => [status.modulePath, status]));
  for (const requirement of parsed.requirements) {
    const status = dependenciesByPath.get(requirement.modulePath);
    if (status) {
      diagnostics.push(...mapUpdateDiagnostics(requirement, status, updateSeverity));
    }
  }

  for (const replacement of parsed.replacements) {
    const status = snapshot.replacements.find((item) => item.sourcePath === replacement.oldPath);
    if (status) {
      diagnostics.push(...mapReplacementDiagnostics(replacement, status));
    }
  }

  diagnostics.push(...mapVulnerabilityDiagnostics(parsed.requirements, snapshot.vulnerabilities));

  const tidyDiagnostic = mapTidyDiagnostic(parsed, snapshot.tidy);
  if (tidyDiagnostic) {
    diagnostics.push(tidyDiagnostic);
  }

  diagnostics.push(...mapToolchainDiagnostics(parsed, snapshot.toolchain));

  return diagnostics;
}
