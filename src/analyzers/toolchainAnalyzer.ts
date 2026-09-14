import {
  classifyAnalysisError,
  type AnalysisError,
  type AnalysisErrorCode,
  type ToolchainAnalysis,
} from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { buildGoEnvironment } from "../execution/environment";
import { ProcessExecutionError, runProcess, type ProcessResult } from "../execution/processRunner";
import { parseToolchainVersion } from "../parsers/goToolchainVersionParser";

export {
  compareToolchainVersions,
  parseToolchainVersion,
  type ToolchainPrereleaseKind,
  type ToolchainPrerelease,
  type ToolchainVersion,
} from "../parsers/goToolchainVersionParser";

export function buildToolchainArgs(): readonly string[] {
  return ["env", "GOVERSION", "GOWORK"];
}

export interface ToolchainAnalyzerInput {
  readonly module: ModuleContext;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly required?: string;
  readonly suggested?: string;
}

export async function analyzeToolchain(input: ToolchainAnalyzerInput): Promise<ToolchainAnalysis> {
  try {
    const result = await runProcess({
      executable: input.goExecutable,
      args: [...buildToolchainArgs()],
      cwd: input.module.moduleRoot,
      env: buildGoEnvironment(),
      timeoutMs: input.timeoutMs,
      stdoutLimitBytes: 1024 * 1024,
      stderrLimitBytes: 1024 * 1024,
      signal: input.signal,
    });
    if (result.exitCode !== 0) return failedAnalysis(result);
    const installed = (result.stdout.split(/\r?\n/, 1)[0] ?? "").trim();
    if (!parseToolchainVersion(installed)) {
      const message = `go env reported an unrecognized GOVERSION value: ${installed || "(empty)"}`;
      return failedToolchainAnalysis(
        classifyAnalysisError(new ProcessExecutionError(message, "exit-nonzero", undefined, result)),
        message,
      );
    }
    return Object.freeze({
      state: "complete" as const,
      installed,
      ...(input.required ? { required: input.required } : {}),
      ...(input.suggested ? { suggested: input.suggested } : {}),
      errors: Object.freeze([]),
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    return failedToolchainAnalysis(
      classifyAnalysisError(error),
      error instanceof Error ? error.message : String(error),
    );
  }
}

function failedAnalysis(result: ProcessResult): ToolchainAnalysis {
  const message = result.stderr.trim() || `go env GOVERSION GOWORK exited ${result.exitCode}`;
  return failedToolchainAnalysis(
    classifyAnalysisError(new ProcessExecutionError(message, "exit-nonzero", undefined, result)),
    message,
  );
}

function failedToolchainAnalysis(code: AnalysisErrorCode, message: string): ToolchainAnalysis {
  const errors: readonly AnalysisError[] = Object.freeze([{ code, message }]);
  return Object.freeze({ state: "failed" as const, errors });
}
