export interface GoListModule {
  readonly Path: string;
  readonly Version?: string;
  readonly Main?: boolean;
  readonly Indirect?: boolean;
  readonly Dir?: string;
  readonly GoMod?: string;
  readonly GoVersion?: string;
  readonly Update?: { readonly Path: string; readonly Version?: string };
  readonly Replace?: GoListModule;
  readonly Retracted?: readonly string[];
  readonly Deprecated?: string;
  readonly Error?: { readonly Err: string };
}

export function parseGoListJson(input: string): readonly GoListModule[] {
  const results: GoListModule[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const parsed: unknown = JSON.parse(input.slice(start, index + 1));
        if (isGoListModule(parsed)) results.push(parsed);
        start = -1;
      }
    }
  }
  if (depth !== 0 || inString) throw new Error("Incomplete go list JSON stream");
  return results;
}

function isGoListModule(value: unknown): value is GoListModule {
  return typeof value === "object" && value !== null && typeof (value as { Path?: unknown }).Path === "string";
}
