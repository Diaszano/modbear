import { readFile } from "node:fs/promises";
import {
  classifyAnalysisError,
  type AnalysisError,
  type DependencyStatus,
  type ImportedVulnerabilitySeverity,
  type ModuleAnalysisSnapshot,
  type ReplacementStatus,
  type TidyAnalysis,
  type ToolchainAnalysis,
} from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import type { VulnerabilityAnalysis } from "../domain/vulnerability";
import { ProcessExecutionError } from "../execution/processRunner";
import { analyzeReplacements, attachReplacementStatuses } from "../analyzers/replacementAnalyzer";
import { analyzeTidy } from "../analyzers/tidyAnalyzer";
import { analyzeToolchain } from "../analyzers/toolchainAnalyzer";
import { analyzeUpdates, buildGoListArgs } from "../analyzers/updateAnalyzer";
import type { VulnerabilityCoordinator } from "../analyzers/vulnerabilityAnalyzer";
import { analyzeVulnerabilities } from "../analyzers/vulnerabilityAnalyzer";
import type { AnalysisCache } from "../cache/analysisCache";
import { createCacheKey } from "../cache/cacheKey";
import { getGoVersion } from "../execution/goToolIdentity";
import { parseGoModPositions } from "../parsers/goModPositionParser";
import type { Logger } from "../logging/logger";

export type ScanTrigger = "background" | "save" | "manual";

export interface VulnerabilityScanOptions {
  readonly enabled: boolean;
  readonly govulncheckPath: string;
  readonly timeoutMs: number;
  readonly coordinator: VulnerabilityCoordinator;
  readonly ttlMs: number;
  readonly includeTests: boolean;
  readonly buildTags: readonly string[];
  readonly database: string;
  readonly importedSeverity: ImportedVulnerabilitySeverity;
}

export interface HealthScanOptions {
  readonly tidyEnabled: boolean;
  readonly ttlMs: number;
}

interface PhaseOutcome<T> {
  readonly value: T;
  readonly error?: AnalysisError;
}

const NOT_RUN_VULNERABILITIES: VulnerabilityAnalysis = {
  state: "not-run",
  findings: [],
  advisories: {},
  errors: [],
};

function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.message === "Scan cancelled";
}

async function settlePhase<T>(signal: AbortSignal, run: () => Promise<T>, fallback: () => T): Promise<PhaseOutcome<T>> {
  try {
    return { value: await run() };
  } catch (error) {
    if (signal.aborted || isCancellation(error)) throw error;
    return {
      value: fallback(),
      error: {
        code: classifyAnalysisError(error),
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function failedTidyFallback(message: string): TidyAnalysis {
  return { state: "failed", consistent: false, errors: [{ code: "unknown", message }] };
}

function failedToolchainFallback(message: string): ToolchainAnalysis {
  return { state: "failed", errors: [{ code: "unknown", message }] };
}

export class ModuleScanner {
  public constructor(
    private readonly cache: AnalysisCache,
    private readonly goExecutable: string,
    private readonly timeoutMs: number,
    private readonly ttlMs: number,
    private readonly logger?: Logger,
    private readonly vulnerability?: VulnerabilityScanOptions,
    private readonly health?: HealthScanOptions,
  ) {}

  public async scan(
    module: ModuleContext,
    signal: AbortSignal,
    trigger: ScanTrigger = "background",
  ): Promise<ModuleAnalysisSnapshot> {
    const startTime = Date.now();
    try {
      const [goMod, goSum, goWork, goVersion] = await Promise.all([
        readFile(module.goModPath, "utf8"),
        module.goSumPath ? readFile(module.goSumPath, "utf8").catch(() => "") : Promise.resolve(""),
        module.goWorkPath ? readFile(module.goWorkPath, "utf8").catch(() => "") : Promise.resolve(""),
        getGoVersion(this.goExecutable).catch(() => ""),
      ]);
      const tidyEligible = (this.health?.tidyEnabled ?? false) && trigger !== "background";
      const contentHash = createCacheKey({
        moduleRoot: module.moduleRoot,
        goMod,
        goSum,
        goWork,
        goVersion,
        goExecutable: this.goExecutable,
        timeoutMs: this.timeoutMs,
        vulnerability: this.vulnerability && {
          enabled: this.vulnerability.enabled,
          govulncheckPath: this.vulnerability.govulncheckPath,
          timeoutMs: this.vulnerability.timeoutMs,
          includeTests: this.vulnerability.includeTests,
          buildTags: [...this.vulnerability.buildTags],
          database: this.vulnerability.database,
          importedSeverity: this.vulnerability.importedSeverity,
        },
        tidy: { enabled: this.health?.tidyEnabled ?? false, eligible: tidyEligible },
      });
      const cached = await this.cache.get(contentHash);
      const now = Date.now();
      const cachedAgeMs = cached ? now - Date.parse(cached.createdAt) : Number.POSITIVE_INFINITY;
      const reuseUpdates = cachedAgeMs <= this.ttlMs;
      const reuseVulnerabilities = !!cached && cachedAgeMs <= (this.vulnerability?.ttlMs ?? Number.POSITIVE_INFINITY);
      const tidyAgeMs =
        cached?.tidy?.scannedAt !== undefined ? now - Date.parse(cached.tidy.scannedAt) : Number.POSITIVE_INFINITY;
      const reuseTidy = !!cached?.tidy && tidyAgeMs <= (this.health?.ttlMs ?? Number.POSITIVE_INFINITY);
      const isHit = reuseUpdates && reuseVulnerabilities && (!tidyEligible || reuseTidy);

      // Compromise: scan.started is emitted after cache lookup so it can include the cache hit/miss status,
      // but before any actual update analysis/subprocess execution begins.
      if (this.logger && typeof this.logger.event === "function") {
        this.logger.event("info", "scan.started", {
          kind: "updates",
          cache: isHit ? "hit" : "miss",
        });
      }

      if (isHit) {
        if (this.logger && typeof this.logger.event === "function") {
          this.logger.event("info", "scan.finished", {
            outcome: "success",
            durationMs: Date.now() - startTime,
            cache: "hit",
            dependencies: cached.dependencies.length,
          });
        }
        return cached;
      }

      const parsed = parseGoModPositions(goMod);
      if (!reuseUpdates && this.logger && typeof this.logger.command === "function") {
        this.logger.command(this.goExecutable, buildGoListArgs(parsed.requirements), module.moduleRoot);
      }

      const [updatesOutcome, replacementsOutcome, vulnerabilitiesOutcome, tidyOutcome, toolchainOutcome] =
        await Promise.all([
          reuseUpdates
            ? undefined
            : settlePhase(
                signal,
                () =>
                  analyzeUpdates({
                    module,
                    requirements: parsed.requirements,
                    goExecutable: this.goExecutable,
                    timeoutMs: this.timeoutMs,
                    signal,
                  }),
                (): readonly DependencyStatus[] => [],
              ),
          reuseUpdates
            ? undefined
            : settlePhase(
                signal,
                () => analyzeReplacements(module.moduleRoot, parsed.replacements),
                (): readonly ReplacementStatus[] => [],
              ),
          reuseVulnerabilities
            ? undefined
            : settlePhase(
                signal,
                () => this.analyzeVulnerabilities(module.moduleRoot, signal),
                (): VulnerabilityAnalysis => NOT_RUN_VULNERABILITIES,
              ),
          tidyEligible && !reuseTidy
            ? settlePhase(
                signal,
                () =>
                  analyzeTidy({
                    module,
                    goExecutable: this.goExecutable,
                    timeoutMs: this.timeoutMs,
                    signal,
                  }),
                () => failedTidyFallback("go mod tidy -diff could not be completed because the analysis phase failed."),
              )
            : undefined,
          settlePhase(
            signal,
            () =>
              analyzeToolchain({
                module,
                goExecutable: this.goExecutable,
                timeoutMs: this.timeoutMs,
                ...(parsed.go ? { required: parsed.go.version } : {}),
                ...(parsed.toolchain ? { suggested: parsed.toolchain.version } : {}),
                signal,
              }),
            () => failedToolchainFallback("go env GOVERSION GOWORK could not be completed."),
          ),
        ]);

      const dependencies = reuseUpdates
        ? cached!.dependencies
        : attachReplacementStatuses(updatesOutcome!.value, replacementsOutcome!.value);
      const replacements = reuseUpdates ? cached!.replacements : replacementsOutcome!.value;
      const vulnerabilities = reuseVulnerabilities ? cached.vulnerabilities : vulnerabilitiesOutcome!.value;
      const tidy =
        tidyEligible && !reuseTidy ? tidyOutcome!.value : cached?.tidy && tidyEligible ? cached.tidy : undefined;

      const phaseErrors = [
        reuseUpdates || !updatesOutcome ? undefined : updatesOutcome.error,
        reuseUpdates || !replacementsOutcome ? undefined : replacementsOutcome.error,
        reuseVulnerabilities || !vulnerabilitiesOutcome ? undefined : vulnerabilitiesOutcome.error,
        !tidyOutcome ? undefined : tidyOutcome.error,
        toolchainOutcome.error,
      ].filter((error): error is AnalysisError => error !== undefined);

      for (const error of phaseErrors) {
        if (this.logger && typeof this.logger.event === "function") {
          this.logger.event("warn", "scan.phase.failed", { code: error.code, message: error.message });
        }
      }

      const snapshot: ModuleAnalysisSnapshot = {
        moduleId: module.id,
        contentHash,
        createdAt: new Date().toISOString(),
        stale: false,
        updateState: phaseErrors.length > 0 ? "partial" : "complete",
        dependencies,
        replacements,
        vulnerabilities,
        ...(tidy ? { tidy } : {}),
        toolchain: toolchainOutcome.value,
        errors: phaseErrors,
      };
      await this.cache.set(contentHash, snapshot);

      if (this.logger && typeof this.logger.event === "function") {
        this.logger.event("info", "scan.finished", {
          outcome: phaseErrors.length > 0 ? "partial" : "success",
          durationMs: Date.now() - startTime,
          cache: "miss",
          dependencies: snapshot.dependencies.length,
        });
      }

      return snapshot;
    } catch (err) {
      if (signal.aborted || isCancellation(err)) {
        throw err;
      }

      const durationMs = Date.now() - startTime;
      const kind = err instanceof ProcessExecutionError ? err.kind : classifyAnalysisError(err);
      const fields: Record<string, string | number | boolean> = {
        kind,
        durationMs,
      };

      if (err instanceof ProcessExecutionError) {
        if (err.result?.exitCode !== undefined && err.result.exitCode !== null) {
          fields.exitCode = err.result.exitCode;
        }
        if (err.result?.stderr) {
          fields.stderr = err.result.stderr;
        } else {
          fields.stderr = err.message;
        }
      } else {
        fields.stderr = err instanceof Error ? err.message : String(err);
      }

      if (this.logger && typeof this.logger.event === "function") {
        this.logger.event("error", "scan.failed", fields);
      }
      throw err;
    }
  }

  private async analyzeVulnerabilities(moduleRoot: string, signal: AbortSignal): Promise<VulnerabilityAnalysis> {
    const vulnerability = this.vulnerability;
    if (!vulnerability?.enabled) {
      return NOT_RUN_VULNERABILITIES;
    }
    return vulnerability.coordinator.run(() =>
      analyzeVulnerabilities({
        moduleRoot,
        govulncheckPath: vulnerability.govulncheckPath,
        timeoutMs: vulnerability.timeoutMs,
        signal,
        ...(this.logger ? { logger: this.logger } : {}),
      }),
    );
  }
}
