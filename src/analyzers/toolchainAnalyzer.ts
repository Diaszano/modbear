import {
  classifyAnalysisError,
  type AnalysisError,
  type ToolchainAnalysis
} from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import type { ParsedGoMod } from "../domain/dependency";
import { buildGoEnvironment } from "../execution/environment";
import { runProcess } from "../execution/processRunner";
import { parseToolchainVersion } from "../parsers/goToolchainVersionParser";

const PUBLIC_FAILURE_MESSAGE = "Toolchain analysis failed.";
const PUBLIC_UNAVAILABLE_MESSAGE = "Toolchain analysis is unavailable.";

export interface ToolchainAnalyzerOptions {
  readonly module: ModuleContext;
  readonly parsed: Pick<ParsedGoMod, "go" | "toolchain">;
  readonly goExecutable: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly workspaceTrusted?: boolean;
}

export async function analyzeToolchain(options: ToolchainAnalyzerOptions): Promise<ToolchainAnalysis> {
  const required = options.parsed.go?.version;
  const suggested = options.parsed.toolchain?.version;
  if (options.workspaceTrusted === false) {
    return unavailable(required, suggested, "workspace-untrusted");
  }

  try {
    const result = await runProcess({
      executable: options.goExecutable,
      args: ["env", "GOVERSION", "GOWORK"],
      cwd: options.module.moduleRoot,
      env: buildGoEnvironment(),
      timeoutMs: options.timeoutMs,
      stdoutLimitBytes: 1 * 1024 * 1024,
      stderrLimitBytes: 1 * 1024 * 1024,
      signal: options.signal
    });
    const installed = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (result.exitCode !== 0 || !installed || !areValidVersions(installed, required, suggested)) {
      return failed({ installed, required, suggested });
    }
    return freezeAnalysis({ state: "complete", installed, ...versions({ required, suggested }), errors: [] });
  } catch (error) {
    return failed({
      required,
      suggested,
      errors: [{ code: classifyAnalysisError(error), message: PUBLIC_FAILURE_MESSAGE }]
    });
  }
}

function areValidVersions(installed: string, required: string | undefined, suggested: string | undefined): boolean {
  return Boolean(
    parseToolchainVersion(installed) &&
    (!required || parseToolchainVersion(required)) &&
    (!suggested || parseToolchainVersion(suggested))
  );
}

function unavailable(
  required: string | undefined,
  suggested: string | undefined,
  code: AnalysisError["code"]
): ToolchainAnalysis {
  return freezeAnalysis({
    state: "unavailable",
    ...versions({ required, suggested }),
    errors: [{ code, message: PUBLIC_UNAVAILABLE_MESSAGE }]
  });
}

function failed(input: {
  readonly installed?: string | undefined;
  readonly required?: string | undefined;
  readonly suggested?: string | undefined;
  readonly errors?: readonly AnalysisError[];
}): ToolchainAnalysis {
  return freezeAnalysis({
    state: "failed",
    ...versions(input),
    errors: input.errors ?? [{ code: "unknown", message: PUBLIC_FAILURE_MESSAGE }]
  });
}

function versions(input: {
  readonly installed?: string | undefined;
  readonly required?: string | undefined;
  readonly suggested?: string | undefined;
}): Pick<ToolchainAnalysis, "installed" | "required" | "suggested"> {
  return {
    ...(input.installed ? { installed: input.installed } : {}),
    ...(input.required ? { required: input.required } : {}),
    ...(input.suggested ? { suggested: input.suggested } : {})
  };
}

function freezeAnalysis(analysis: ToolchainAnalysis): ToolchainAnalysis {
  return Object.freeze({
    ...analysis,
    errors: Object.freeze([...analysis.errors])
  });
}
