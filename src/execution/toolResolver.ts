import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

export async function resolveTool(configured: string | undefined, fallback: string): Promise<string> {
  const candidate = configured?.trim() || fallback;
  if (path.isAbsolute(candidate) || candidate.includes(path.sep)) {
    await access(candidate, constants.X_OK);
  }
  return candidate;
}
