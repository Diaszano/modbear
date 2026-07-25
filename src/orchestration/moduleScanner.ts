import { readFile } from "node:fs/promises";
import { classifyAnalysisError, type AnalysisError, type ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { ProcessExecutionError } from "../execution/processRunner";
import { analyzeReplacements, attachReplacementStatuses } from "../analyzers/replacementAnalyzer";
import { analyzeUpdates, buildGoListArgs } from "../analyzers/updateAnalyzer";
import { analyzeVulnerabilities, VulnerabilityCoordinator } from "../analyzers/vulnerabilityAnalyzer";
import { analyzeTidy } from "../analyzers/tidyAnalyzer";
import { analyzeToolchain } from "../analyzers/toolchainAnalyzer";
import { AnalysisCache } from "../cache/analysisCache";
import { createCacheKey } from "../cache/cacheKey";
import { getGoVersion } from "../execution/goToolIdentity";
import { parseGoModPositions } from "../parsers/goModPositionParser";
import type { Logger } from "../logging/logger";

export interface VulnerabilityScanOptions {
  readonly enabled: boolean;
  readonly govulncheckPath: string;
  readonly timeoutMs: number;
  readonly coordinator: VulnerabilityCoordinator;
  readonly includeTests?: boolean;
  readonly buildTags?: readonly string[];
  readonly database?: string;
}

export interface HealthScanOptions {
  readonly tidyEnabled: boolean;
  readonly tidyTtlMs: number;
  readonly vulnerabilityTtlMs: number;
}

export type ScanTrigger = "background" | "save" | "manual";

export class ModuleScanner {
  public constructor(
    private readonly cache: AnalysisCache,
    private readonly goExecutable: string,
    private readonly timeoutMs: number,
    private readonly ttlMs: number,
    private readonly logger?: Logger,
    private readonly vulnerability?: VulnerabilityScanOptions,
    private readonly health: HealthScanOptions = {
      tidyEnabled: true,
      tidyTtlMs: 10 * 60_000,
      vulnerabilityTtlMs: 360 * 60_000
    }
  ) {}

  public async scan(
    module: ModuleContext,
    signal: AbortSignal,
    trigger: ScanTrigger = "background"
  ): Promise<ModuleAnalysisSnapshot> {
    const startTime = Date.now();
    let isHit = false;
    let contentHash = "";
    try {
      const [goMod, goSum, goWork, goVersion] = await Promise.all([
        readFile(module.goModPath, "utf8"),
        module.goSumPath ? readFile(module.goSumPath, "utf8").catch(() => "") : Promise.resolve(""),
        module.goWorkPath ? readFile(module.goWorkPath, "utf8").catch(() => "") : Promise.resolve(""),
        getGoVersion(this.goExecutable).catch(() => "")
      ]);
      const tidyEligible = this.health.tidyEnabled && trigger !== "background";
      contentHash = createCacheKey({
        moduleRoot: module.moduleRoot,
        goMod,
        goSum,
        goWork,
        goExecutable: this.goExecutable,
        goIdentity: { executable: this.goExecutable, version: goVersion },
        timeoutMs: this.timeoutMs,
        vulnerability: this.vulnerability && {
          enabled: this.vulnerability.enabled,
          govulncheckPath: this.vulnerability.govulncheckPath,
          timeoutMs: this.vulnerability.timeoutMs,
          includeTests: this.vulnerability.includeTests ?? false,
          buildTags: this.vulnerability.buildTags ?? [],
          database: this.vulnerability.database ?? ""
        },
        health: {
          tidyEnabled: this.health.tidyEnabled,
          tidyEligible,
          tidyTtlMs: this.health.tidyTtlMs,
          vulnerabilityTtlMs: this.health.vulnerabilityTtlMs
        }
      });
      const cached = await this.cache.get(contentHash);
      isHit = !!(cached && this.isCacheFresh(cached, tidyEligible));

      // Compromise: scan.started is emitted after cache lookup so it can include the cache hit/miss status,
      // but before any actual update analysis/subprocess execution begins.
      if (this.logger && typeof this.logger.event === "function") {
        this.logger.event("info", "scan.started", {
          kind: "updates",
          cache: isHit ? "hit" : "miss"
        });
      }

      if (isHit) {
        if (this.logger && typeof this.logger.event === "function") {
          this.logger.event("info", "scan.finished", {
            outcome: "success",
            durationMs: Date.now() - startTime,
            cache: "hit",
            dependencies: cached!.dependencies.length
          });
        }
        return cached!;
      }

      const parsed = parseGoModPositions(goMod);
      if (this.logger && typeof this.logger.command === "function") {
        this.logger.command(this.goExecutable, buildGoListArgs(parsed.requirements), module.moduleRoot);
      }
      const [updates, replacements, toolchain, vulnerabilities, tidy] = await Promise.all([
        this.analyzeUpdates(module, parsed.requirements, signal),
        analyzeReplacements(module.moduleRoot, parsed.replacements),
        analyzeToolchain({
          module,
          parsed,
          goExecutable: this.goExecutable,
          timeoutMs: this.timeoutMs,
          signal
        }),
        this.analyzeVulnerabilities(module.moduleRoot, signal),
        this.analyzeTidy(module, signal, tidyEligible)
      ]);
      if (signal.aborted) throw new Error("Scan cancelled");
      const phaseErrors = [
        ...(updates.error ? [updates.error] : []),
        ...toolchain.errors,
        ...vulnerabilities.errors,
        ...tidy.errors
      ];
      const snapshot: ModuleAnalysisSnapshot = {
        moduleId: module.id,
        contentHash,
        createdAt: new Date().toISOString(),
        stale: false,
        updateState: updates.error || toolchain.state === "failed" || tidy.state === "failed" || vulnerabilities.errors.length > 0
          ? "partial"
          : "complete",
        dependencies: attachReplacementStatuses(updates.dependencies, replacements),
        replacements,
        vulnerabilities,
        tidy,
        toolchain,
        errors: phaseErrors
      };
      await this.cache.set(contentHash, snapshot);

      if (this.logger && typeof this.logger.event === "function") {
        this.logger.event("info", "scan.finished", {
          outcome: "success",
          durationMs: Date.now() - startTime,
          cache: "miss",
          dependencies: snapshot.dependencies.length
        });
      }

      return snapshot;
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.message === "Scan cancelled")) {
        throw err;
      }

      const durationMs = Date.now() - startTime;
      const kind = err instanceof ProcessExecutionError ? err.kind : classifyAnalysisError(err);
      const fields: Record<string, string | number | boolean> = {
        kind,
        durationMs
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

  private async analyzeVulnerabilities(moduleRoot: string, signal: AbortSignal) {
    const vulnerability = this.vulnerability;
    if (!vulnerability?.enabled) {
      return { state: "not-run" as const, findings: [], advisories: {}, errors: [] };
    }
    return vulnerability.coordinator.run(() => analyzeVulnerabilities({
      moduleRoot,
      govulncheckPath: vulnerability.govulncheckPath,
      timeoutMs: vulnerability.timeoutMs,
      signal,
      ...(vulnerability.includeTests ? { includeTests: true } : {}),
      ...(vulnerability.buildTags ? { buildTags: vulnerability.buildTags } : {}),
      ...(vulnerability.database ? { database: vulnerability.database } : {}),
      ...(this.logger ? { logger: this.logger } : {})
    }));
  }

  private async analyzeTidy(module: ModuleContext, signal: AbortSignal, eligible: boolean) {
    if (!eligible) return { state: "idle" as const, consistent: false, errors: [] };
    return analyzeTidy({
      module,
      goExecutable: this.goExecutable,
      timeoutMs: this.timeoutMs,
      signal
    });
  }

  private async analyzeUpdates(
    module: ModuleContext,
    requirements: ReturnType<typeof parseGoModPositions>["requirements"],
    signal: AbortSignal
  ): Promise<{ readonly dependencies: Awaited<ReturnType<typeof analyzeUpdates>>; readonly error?: AnalysisError }> {
    try {
      return {
        dependencies: await analyzeUpdates({
          module,
          requirements,
          goExecutable: this.goExecutable,
          timeoutMs: this.timeoutMs,
          signal
        })
      };
    } catch (error) {
      return {
        dependencies: [],
        error: { code: classifyAnalysisError(error), message: "Dependency update analysis failed." }
      };
    }
  }

  private isCacheFresh(snapshot: ModuleAnalysisSnapshot, tidyEligible: boolean): boolean {
    const age = Date.now() - Date.parse(snapshot.createdAt);
    if (!Number.isFinite(age)) return false;
    if (age > this.ttlMs) return false;
    if (this.vulnerability?.enabled && age > this.health.vulnerabilityTtlMs) return false;
    return !tidyEligible || age <= this.health.tidyTtlMs;
  }
}
