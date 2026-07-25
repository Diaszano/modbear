import { createHash } from "node:crypto";
import { getGoVersionSync } from "../execution/goToolIdentity";

export function createCacheKey(input: Record<string, unknown>): string {
  const goBin = (input.goExecutable as string | undefined) || (input.tool as string | undefined) || "go";
  const goVersion = getGoVersionSync(goBin);

  const enrichedInput = {
    ...input,
    resolutionInputs: {
      GOFLAGS: process.env.GOFLAGS ?? "",
      GOPROXY: process.env.GOPROXY ?? "",
      GONOPROXY: process.env.GONOPROXY ?? "",
      GOPRIVATE: process.env.GOPRIVATE ?? "",
      GOSUMDB: process.env.GOSUMDB ?? "",
      GONOSUMDB: process.env.GONOSUMDB ?? "",
      goVersion
    }
  };

  return createHash("sha256").update(stableStringify(enrichedInput)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
