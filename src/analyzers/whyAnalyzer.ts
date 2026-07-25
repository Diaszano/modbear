import type { ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { runProcess } from "../execution/processRunner";
import type { Logger } from "../logging/logger";
import { redactLogMessage } from "../logging/redaction";

export interface ExplainDependencyOptions {
  readonly module: ModuleContext;
  readonly snapshot: Pick<ModuleAnalysisSnapshot, "dependencies">;
  readonly modulePath: string;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly trusted: boolean;
  readonly logger?: Pick<Logger, "error">;
}

export async function explainDependency(options: ExplainDependencyOptions): Promise<string> {
  if (!options.trusted) {
    throwValidationError(options, "Workspace is not trusted.");
  }
  if (!options.snapshot.dependencies.some((dependency) => dependency.modulePath === options.modulePath)) {
    throwValidationError(options, "The selected dependency is no longer available.");
  }

  const result = await runProcess({
    executable: options.goExecutable,
    args: ["mod", "why", "-m", options.modulePath],
    cwd: options.module.moduleRoot,
    env: buildGoEnvironment(),
    timeoutMs: options.timeoutMs,
    stdoutLimitBytes: 10 * 1024 * 1024,
    stderrLimitBytes: 2 * 1024 * 1024,
    signal: options.signal
  });
  if (result.exitCode !== 0) {
    const message = redactLogMessage(result.stderr.trim() || "go mod why failed");
    options.logger?.error(message);
    throw new Error(message);
  }
  return result.stdout;
}

function throwValidationError(options: ExplainDependencyOptions, message: string): never {
  options.logger?.error(message);
  throw new Error(message);
}
