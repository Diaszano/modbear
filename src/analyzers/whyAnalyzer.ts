import { classifyAnalysisError, type AnalysisErrorCode } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { runProcess } from "../execution/processRunner";

export function buildWhyArgs(modulePath: string): readonly string[] {
  return ["mod", "why", "-m", modulePath];
}

export class DependencyExplanationError extends Error {
  public constructor(
    message: string,
    public readonly code: AnalysisErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DependencyExplanationError";
  }
}

export interface ExplainDependencyInput {
  readonly module: ModuleContext;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly modulePath: string;
}

export async function explainDependency(input: ExplainDependencyInput): Promise<string> {
  const modulePath = input.modulePath.trim();
  if (!modulePath) {
    throw new DependencyExplanationError("A module path is required to run go mod why.", "module-resolution");
  }
  try {
    const result = await runProcess({
      executable: input.goExecutable,
      args: [...buildWhyArgs(modulePath)],
      cwd: input.module.moduleRoot,
      env: buildGoEnvironment(),
      timeoutMs: input.timeoutMs,
      stdoutLimitBytes: 10 * 1024 * 1024,
      stderrLimitBytes: 2 * 1024 * 1024,
      signal: input.signal,
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "go mod why failed");
    return result.stdout.trim();
  } catch (error) {
    if (error instanceof DependencyExplanationError) throw error;
    throw new DependencyExplanationError(
      error instanceof Error ? error.message : String(error),
      classifyAnalysisError(error),
      error,
    );
  }
}
