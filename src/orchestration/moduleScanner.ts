import { readFile } from "node:fs/promises";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";
import type { ModuleContext } from "../domain/module";
import { analyzeReplacements, attachReplacementStatuses } from "../analyzers/replacementAnalyzer";
import { analyzeUpdates } from "../analyzers/updateAnalyzer";
import { AnalysisCache } from "../cache/analysisCache";
import { createCacheKey } from "../cache/cacheKey";
import { parseGoModPositions } from "../parsers/goModPositionParser";

export class ModuleScanner {
  public constructor(
    private readonly cache: AnalysisCache,
    private readonly goExecutable: string,
    private readonly timeoutMs: number,
    private readonly ttlMs: number
  ) {}

  public async scan(module: ModuleContext, signal: AbortSignal): Promise<ModuleAnalysisSnapshot> {
    const [goMod, goSum, goWork] = await Promise.all([
      readFile(module.goModPath, "utf8"),
      module.goSumPath ? readFile(module.goSumPath, "utf8").catch(() => "") : Promise.resolve(""),
      module.goWorkPath ? readFile(module.goWorkPath, "utf8").catch(() => "") : Promise.resolve("")
    ]);
    const contentHash = createCacheKey({
      moduleRoot: module.moduleRoot,
      goMod,
      goSum,
      goWork,
      goExecutable: this.goExecutable,
      timeoutMs: this.timeoutMs
    });
    const cached = await this.cache.get(contentHash);
    if (cached && Date.now() - Date.parse(cached.createdAt) <= this.ttlMs) return cached;

    const parsed = parseGoModPositions(goMod);
    const [rawDependencies, replacements] = await Promise.all([
      analyzeUpdates({
        module,
        requirements: parsed.requirements,
        goExecutable: this.goExecutable,
        timeoutMs: this.timeoutMs,
        signal
      }),
      analyzeReplacements(module.moduleRoot, parsed.replacements)
    ]);
    const snapshot: ModuleAnalysisSnapshot = {
      moduleId: module.id,
      contentHash,
      createdAt: new Date().toISOString(),
      stale: false,
      updateState: "complete",
      dependencies: attachReplacementStatuses(rawDependencies, replacements),
      replacements,
      errors: []
    };
    await this.cache.set(contentHash, snapshot);
    return snapshot;
  }
}
