import { readFile, writeFile, mkdir, unlink, rename, readdir } from "node:fs/promises";
import path from "node:path";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";

interface CacheEnvelope {
  readonly schema: 3;
  readonly snapshot: ModuleAnalysisSnapshot;
  readonly lastAccessedAt: number;
}

function isValidSnapshot(value: unknown): value is ModuleAnalysisSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<ModuleAnalysisSnapshot>;
  return (
    typeof s.moduleId === "string" &&
    typeof s.contentHash === "string" &&
    typeof s.createdAt === "string" &&
    typeof s.stale === "boolean" &&
    typeof s.updateState === "string" &&
    Array.isArray(s.dependencies) &&
    Array.isArray(s.replacements) &&
    typeof s.vulnerabilities === "object" &&
    s.vulnerabilities !== null &&
    typeof (s.vulnerabilities as any).state === "string" &&
    Array.isArray((s.vulnerabilities as any).findings) &&
    Array.isArray(s.errors)
  );
}

export class AnalysisCache {
  public constructor(private readonly root: string) {}

  public async get(key: string): Promise<ModuleAnalysisSnapshot | undefined> {
    const filePath = this.file(key);
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(content);
      if (parsed && parsed.schema === 3 && isValidSnapshot(parsed.snapshot)) {
        // Update lastAccessedAt on access
        const updatedEnvelope: CacheEnvelope = {
          schema: 3,
          snapshot: parsed.snapshot,
          lastAccessedAt: Date.now()
        };
        await this.writeAtomic(key, updatedEnvelope);
        return parsed.snapshot;
      }
      // If we read a file that has the wrong schema or invalid snapshot, delete it.
      await unlink(filePath).catch(() => undefined);
      return undefined;
    } catch (err) {
      if (err instanceof Error && (err as any).code !== "ENOENT") {
        await unlink(filePath).catch(() => undefined);
      }
      return undefined;
    }
  }

  public async set(key: string, snapshot: ModuleAnalysisSnapshot): Promise<void> {
    const envelope: CacheEnvelope = {
      schema: 3,
      snapshot,
      lastAccessedAt: Date.now()
    };
    await this.writeAtomic(key, envelope);
    await this.prune();
  }

  public async delete(key: string): Promise<void> {
    await unlink(this.file(key)).catch(() => undefined);
  }

  private file(key: string): string {
    return path.join(this.root, `${key}.json`);
  }

  private async writeAtomic(key: string, envelope: CacheEnvelope): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const filePath = this.file(key);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(envelope), "utf8");
    await rename(tmpPath, filePath);
  }

  private async prune(): Promise<void> {
    try {
      const files = await readdir(this.root);
      const cacheFiles = files.filter(f => /^[a-f0-9]{64}\.json$/.test(f));
      const entries: { file: string; lastAccessedAt: number }[] = [];

      for (const filename of cacheFiles) {
        const filePath = path.join(this.root, filename);
        try {
          const content = await readFile(filePath, "utf8");
          const parsed = JSON.parse(content);
          if (
            parsed &&
            parsed.schema === 3 &&
            typeof parsed.lastAccessedAt === "number" &&
            isValidSnapshot(parsed.snapshot)
          ) {
            entries.push({ file: filePath, lastAccessedAt: parsed.lastAccessedAt });
          } else {
            await unlink(filePath).catch(() => undefined);
          }
        } catch {
          await unlink(filePath).catch(() => undefined);
        }
      }

      if (entries.length > 100) {
        entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
        const toDelete = entries.slice(0, entries.length - 100);
        for (const entry of toDelete) {
          await unlink(entry.file).catch(() => undefined);
        }
      }
    } catch {
      // Ignore errors reading or pruning the cache dir
    }
  }
}
