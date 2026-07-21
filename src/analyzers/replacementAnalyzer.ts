import { stat } from "node:fs/promises";
import path from "node:path";
import type { DependencyStatus, ReplacementStatus } from "../domain/analysis";
import type { GoModReplacement } from "../domain/dependency";

export async function analyzeReplacement(
  moduleRoot: string,
  replacement: GoModReplacement
): Promise<ReplacementStatus> {
  const source = {
    sourcePath: replacement.oldPath,
    ...(replacement.oldVersion ? { sourceVersion: replacement.oldVersion } : {})
  };
  if (!replacement.local) {
    return {
      ...source,
      targetPath: replacement.newPath,
      ...(replacement.newVersion ? { targetVersion: replacement.newVersion } : {}),
      local: false
    };
  }
  const targetPath = path.resolve(moduleRoot, replacement.newPath);
  const exists = await stat(targetPath).then((value) => value.isDirectory(), () => false);
  return { ...source, targetPath, local: true, exists };
}

export async function analyzeReplacements(
  moduleRoot: string,
  replacements: readonly GoModReplacement[]
): Promise<readonly ReplacementStatus[]> {
  return Promise.all(replacements.map((replacement) => analyzeReplacement(moduleRoot, replacement)));
}

export function attachReplacementStatuses(
  dependencies: readonly DependencyStatus[],
  replacements: readonly ReplacementStatus[]
): readonly DependencyStatus[] {
  const bySource = new Map(replacements.map((replacement) => [replacement.sourcePath, replacement]));
  return dependencies.map((dependency) => {
    const replacement = bySource.get(dependency.modulePath);
    if (!replacement) return dependency;
    if (replacement.local) {
      return {
        modulePath: dependency.modulePath,
        installedVersion: dependency.installedVersion,
        retractionRationales: [],
        replacement,
        errors: dependency.errors
      };
    }
    return { ...dependency, replacement };
  });
}
