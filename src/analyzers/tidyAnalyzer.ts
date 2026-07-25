import { classifyAnalysisError, type TidyAnalysis } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { runProcess } from "../execution/processRunner";
import { classifyTidyResult } from "../parsers/tidyDiffParser";

const PUBLIC_FAILURE_MESSAGE = "Tidy analysis failed.";

export interface TidyAnalyzerOptions {
  readonly module: ModuleContext;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export async function analyzeTidy(options: TidyAnalyzerOptions): Promise<TidyAnalysis> {
  try {
    const result = await runProcess({
      executable: options.goExecutable,
      args: ["mod", "tidy", "-diff"],
      cwd: options.module.moduleRoot,
      env: buildGoEnvironment(),
      timeoutMs: options.timeoutMs,
      stdoutLimitBytes: 20 * 1024 * 1024,
      stderrLimitBytes: 5 * 1024 * 1024,
      signal: options.signal
    });
    const tidy = classifyTidyResult(result.exitCode, result.stdout, result.stderr);
    if (tidy.kind === "clean") {
      return { state: "complete", consistent: true, errors: [] };
    }
    if (tidy.kind === "diff") {
      return { state: "complete", consistent: false, diff: tidy.diff, errors: [] };
    }
    return {
      state: "failed",
      consistent: false,
      errors: [{ code: "unknown", message: PUBLIC_FAILURE_MESSAGE }]
    };
  } catch (error) {
    return {
      state: "failed",
      consistent: false,
      errors: [{ code: classifyAnalysisError(error), message: PUBLIC_FAILURE_MESSAGE }]
    };
  }
}
