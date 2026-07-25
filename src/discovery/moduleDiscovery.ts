import { opendir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { ModuleContext } from "../domain/module";
import { parseGoWorkUses } from "./goWorkParser";

const EXCLUDED = new Set([".git", "vendor", "node_modules", "testdata", ".cache"]);
const MAX_DIRECTORIES = 5_000;

export interface ModuleDiscoveryResult {
  readonly modules: readonly ModuleContext[];
  readonly errors: readonly Error[];
}

export async function discoverModules(
  roots: readonly string[],
  signal: AbortSignal
): Promise<ModuleDiscoveryResult> {
  const modules = new Map<string, ModuleContext>();
  const workspaces: Array<{ workspaceFolder: string; goWorkPath: string }> = [];
  const seenDirectories = new Set<string>();
  const errors: Error[] = [];
  let visited = 0;

  const addModule = async (
    candidateRoot: string,
    workspaceFolder: string,
    goWorkPath?: string
  ): Promise<void> => {
    const moduleRoot = await realpath(candidateRoot);
    const goModPath = path.join(moduleRoot, "go.mod");
    const isModule = await stat(goModPath).then((value) => value.isFile(), () => false);
    if (!isModule) return;
    const goSumCandidate = path.join(moduleRoot, "go.sum");
    const goSumPath = await stat(goSumCandidate).then(
      (value) => value.isFile() ? goSumCandidate : undefined,
      () => undefined
    );
    const existing = modules.get(moduleRoot);
    const resolvedGoWorkPath = goWorkPath ?? existing?.goWorkPath;
    const ctx: ModuleContext = {
      id: moduleRoot,
      moduleRoot,
      goModPath,
      workspaceFolder: existing?.workspaceFolder ?? workspaceFolder,
      ...(goSumPath ? { goSumPath } : {}),
      ...(resolvedGoWorkPath ? { goWorkPath: resolvedGoWorkPath } : {})
    };
    modules.set(moduleRoot, ctx);
  };

  const walk = async (directory: string, workspaceFolder: string): Promise<void> => {
    if (signal.aborted) throw new Error("Discovery cancelled");
    let realDirectory: string;
    try {
      realDirectory = await realpath(directory);
    } catch (err) {
      if (signal.aborted) throw new Error("Discovery cancelled");
      errors.push(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (seenDirectories.has(realDirectory)) return;
    seenDirectories.add(realDirectory);
    visited += 1;
    if (visited > MAX_DIRECTORIES) {
      throw new Error(`Discovery exceeded ${MAX_DIRECTORIES} directories`);
    }

    let dir;
    try {
      dir = await opendir(realDirectory);
    } catch (err) {
      if (signal.aborted) throw new Error("Discovery cancelled");
      errors.push(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    try {
      for await (const entry of dir) {
        if (signal.aborted) throw new Error("Discovery cancelled");
        const entryPath = path.join(realDirectory, entry.name);
        try {
          if (entry.name === "go.mod" && entry.isFile()) {
            await addModule(realDirectory, workspaceFolder);
          } else if (entry.name === "go.work" && entry.isFile()) {
            workspaces.push({ workspaceFolder, goWorkPath: await realpath(entryPath) });
          } else if (entry.isDirectory() && !EXCLUDED.has(entry.name)) {
            await walk(entryPath, workspaceFolder);
          }
        } catch (err) {
          if (signal.aborted || (err instanceof Error && err.message.includes("exceeded"))) throw err;
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.message.includes("exceeded"))) throw err;
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  };

  for (const root of roots) {
    try {
      await walk(root, root);
    } catch (err) {
      if (signal.aborted) throw new Error("Discovery cancelled");
      errors.push(err instanceof Error ? err : new Error(String(err)));
      if (err instanceof Error && err.message.includes("exceeded")) break;
    }
  }

  for (const workspace of workspaces) {
    if (signal.aborted) throw new Error("Discovery cancelled");
    try {
      const uses = parseGoWorkUses(await readFile(workspace.goWorkPath, "utf8"));
      const goWorkDirectory = path.dirname(workspace.goWorkPath);
      for (const usePath of uses) {
        const candidate = path.resolve(goWorkDirectory, usePath);
        await addModule(candidate, workspace.workspaceFolder, workspace.goWorkPath).catch((err) => {
          if (signal.aborted) throw new Error("Discovery cancelled");
          errors.push(err instanceof Error ? err : new Error(String(err)));
        });
      }
    } catch (err) {
      if (signal.aborted) throw new Error("Discovery cancelled");
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    modules: [...modules.values()].sort((a, b) => a.moduleRoot.localeCompare(b.moduleRoot)),
    errors
  };
}
