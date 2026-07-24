import { readFile } from "node:fs/promises";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { analyzeReplacements, attachReplacementStatuses } from "../analyzers/replacementAnalyzer";
import { analyzeUpdates, buildGoListArgs } from "../analyzers/updateAnalyzer";
import { analyzeVulnerabilities, VulnerabilityCoordinator } from "../analyzers/vulnerabilityAnalyzer";
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
}

export class ModuleScanner {
  public constructor(
    private readonly cache: AnalysisCache,
    private readonly goExecutable: string,
    private readonly timeoutMs: number,
    private readonly ttlMs: number,
    private readonly logger?: Logger,
    private readonly vulnerability?: VulnerabilityScanOptions
  ) {}

  public async scan(module: ModuleContext, signal: AbortSignal): Promise<ModuleAnalysisSnapshot> {
    const [goMod, goSum, goWork] = await Promise.all([
      readFile(module.goModPath, "utf8"),
      module.goSumPath ? readFile(module.goSumPath, "utf8").catch(() => "") : Promise.resolve(""),
      module.goWorkPath ? readFile(module.goWorkPath, "utf8").catch(() => "") : Promise.resolve(""),
      getGoVersion(this.goExecutable).catch(() => "")
    ]);
    const contentHash = createCacheKey({
      moduleRoot: module.moduleRoot,
      goMod,
      goSum,
      goWork,
      goExecutable: this.goExecutable,
      timeoutMs: this.timeoutMs,
      vulnerability: this.vulnerability && {
        enabled: this.vulnerability.enabled,
        govulncheckPath: this.vulnerability.govulncheckPath,
        timeoutMs: this.vulnerability.timeoutMs
      }
    });
    const cached = await this.cache.get(contentHash);
    if (cached && Date.now() - Date.parse(cached.createdAt) <= this.ttlMs) return cached;

    const parsed = parseGoModPositions(goMod);
    if (this.logger) {
      this.logger.command(this.goExecutable, buildGoListArgs(parsed.requirements), module.moduleRoot);
    }
    const [rawDependencies, replacements, vulnerabilities] = await Promise.all([
      analyzeUpdates({
        module,
        requirements: parsed.requirements,
        goExecutable: this.goExecutable,
        timeoutMs: this.timeoutMs,
        signal
      }),
      analyzeReplacements(module.moduleRoot, parsed.replacements),
      this.analyzeVulnerabilities(module.moduleRoot, signal)
    ]);
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: module.id,
      contentHash,
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: attachReplacementStatuses(rawDependencies, replacements),
      replacements,
      vulnerabilities,
      errors: []
    };
    await this.cache.set(contentHash, snapshot);
    return snapshot;
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
      ...(this.logger ? { logger: this.logger } : {})
    }));
  }
}
