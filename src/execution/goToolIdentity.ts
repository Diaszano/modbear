import { spawnSync } from "node:child_process";
import { runProcess } from "./processRunner";

const versionCache = new Map<string, string>();

export async function getGoVersion(goExecutable: string): Promise<string> {
  const cached = versionCache.get(goExecutable);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const result = await runProcess({
      executable: goExecutable,
      args: ["version"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdoutLimitBytes: 1024 * 1024,
      stderrLimitBytes: 1024 * 1024,
    });
    const version = result.stdout.trim();
    versionCache.set(goExecutable, version);
    return version;
  } catch {
    return getGoVersionSync(goExecutable);
  }
}

export function getGoVersionSync(goExecutable: string): string {
  const cached = versionCache.get(goExecutable);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const result = spawnSync(goExecutable, ["version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const version = (result.stdout || "").trim();
    versionCache.set(goExecutable, version);
    return version;
  } catch {
    return "";
  }
}
