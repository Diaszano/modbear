import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { ModuleAnalysisSnapshot } from "../domain/analysis";

interface CacheEnvelope {
  readonly schema: 1;
  readonly snapshot: ModuleAnalysisSnapshot;
}

export class AnalysisCache {
  public constructor(private readonly root: string) {}

  public async get(key: string): Promise<ModuleAnalysisSnapshot | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.file(key), "utf8")) as CacheEnvelope;
      return parsed.schema === 1 ? parsed.snapshot : undefined;
    } catch {
      return undefined;
    }
  }

  public async set(key: string, snapshot: ModuleAnalysisSnapshot): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.file(key), JSON.stringify({ schema: 1, snapshot } satisfies CacheEnvelope), "utf8");
  }

  public async delete(key: string): Promise<void> {
    await unlink(this.file(key)).catch(() => undefined);
  }

  private file(key: string): string {
    return path.join(this.root, `${key}.json`);
  }
}
