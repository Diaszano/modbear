import {
  classifyAnalysisError,
  type AnalysisError,
  type AnalysisErrorCode,
  type TidyAnalysis,
} from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { ProcessExecutionError, runProcess, type ProcessResult } from "../execution/processRunner";
export type TidyCommandResult =
  | { readonly kind: "clean" }
  | { readonly kind: "diff"; readonly diff: string }
  | { readonly kind: "error"; readonly message: string };

export function classifyTidyResult(exitCode: number | null, stdout: string, stderr: string): TidyCommandResult {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("diff ") && trimmed.includes("\n--- ") && trimmed.includes("\n+++ "))
    return { kind: "diff", diff: stdout };
  if (exitCode === 0 && !trimmed && !stderr.trim()) return { kind: "clean" };
  return { kind: "error", message: stderr.trim() || trimmed || `go mod tidy -diff exited ${exitCode}` };
}

export function buildTidyArgs(): readonly string[] {
  return ["mod", "tidy", "-diff"];
}

export interface TidyAnalyzerInput {
  readonly module: ModuleContext;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export async function analyzeTidy(input: TidyAnalyzerInput): Promise<TidyAnalysis> {
  try {
    const result = await runProcess({
      executable: input.goExecutable,
      args: [...buildTidyArgs()],
      cwd: input.module.moduleRoot,
      env: buildGoEnvironment(),
      timeoutMs: input.timeoutMs,
      stdoutLimitBytes: 20 * 1024 * 1024,
      stderrLimitBytes: 5 * 1024 * 1024,
      signal: input.signal,
    });
    return toTidyAnalysis(classifyTidyResult(result.exitCode, result.stdout, result.stderr), result);
  } catch (error) {
    return failedTidyAnalysis(classifyAnalysisError(error), error instanceof Error ? error.message : String(error));
  }
}

function toTidyAnalysis(classified: TidyCommandResult, result: ProcessResult): TidyAnalysis {
  switch (classified.kind) {
    case "clean":
      return Object.freeze({
        state: "complete" as const,
        consistent: true,
        errors: Object.freeze([]),
        scannedAt: new Date().toISOString(),
      });
    case "diff":
      return Object.freeze({
        state: "complete" as const,
        consistent: false,
        diff: classified.diff,
        errors: Object.freeze([]),
        scannedAt: new Date().toISOString(),
      });
    case "error":
      return failedTidyAnalysis(
        classifyAnalysisError(new ProcessExecutionError(classified.message, "exit-nonzero", undefined, result)),
        classified.message,
      );
  }
}

function failedTidyAnalysis(code: AnalysisErrorCode, message: string): TidyAnalysis {
  const errors: readonly AnalysisError[] = Object.freeze([{ code, message }]);
  return Object.freeze({ state: "failed" as const, consistent: false, errors });
}
