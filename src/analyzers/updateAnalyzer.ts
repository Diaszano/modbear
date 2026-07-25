import type { DependencyStatus } from "../domain/analysis";
import type { GoModRequirement } from "../domain/dependency";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { requireSuccessfulExit } from "../execution/processOutcome";
import { runProcess } from "../execution/processRunner";
import { parseGoListJson, type GoListModule } from "../parsers/goListJsonParser";
import { GoListJsonStreamParser } from "../parsers/goListJsonStreamParser";
import { classifyUpdate } from "../parsers/goVersionParser";

export function buildGoListArgs(requirements: readonly GoModRequirement[] = []): readonly string[] {
  if (requirements.length > 0) {
    return ["list", "-m", "-u", "-json", "-mod=readonly", ...requirements.map((r) => r.modulePath)];
  }
  return ["list", "-m", "-u", "-json", "-mod=readonly", "all"];
}

export function analyzeUpdateOutput(
  requirements: readonly GoModRequirement[],
  modules: readonly GoListModule[]
): readonly DependencyStatus[] {
  const byPath = new Map(modules.map((module) => [module.Path, module]));
  return requirements.map((requirement) => {
    const module = byPath.get(requirement.modulePath);
    const availableVersion = module?.Update?.Version;
    return {
      modulePath: requirement.modulePath,
      installedVersion: requirement.version,
      ...(availableVersion ? {
        availableVersion,
        updateKind: classifyUpdate(requirement.version, availableVersion)
      } : {}),
      ...(module?.Deprecated ? { deprecatedMessage: module.Deprecated } : {}),
      retractionRationales: module?.Retracted ?? [],
      errors: module?.Error ? [{ code: "module-resolution" as const, message: module.Error.Err }] : []
    };
  });
}

export async function analyzeUpdates(input: {
  readonly module: ModuleContext;
  readonly requirements: readonly GoModRequirement[];
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}): Promise<readonly DependencyStatus[]> {
  if (input.requirements.length === 0) {
    return [];
  }
  const parser = new GoListJsonStreamParser();
  const result = await runProcess({
    executable: input.goExecutable,
    args: [...buildGoListArgs(input.requirements)],
    cwd: input.module.moduleRoot,
    env: buildGoEnvironment(),
    timeoutMs: input.timeoutMs,
    stdoutLimitBytes: 50 * 1024 * 1024,
    stderrLimitBytes: 5 * 1024 * 1024,
    signal: input.signal,
    collectStdout: false,
    onStdoutChunk: (chunk) => parser.push(chunk)
  });
  requireSuccessfulExit(result, "go list");
  const modules = parser.finish();
  return analyzeUpdateOutput(input.requirements, modules);
}
