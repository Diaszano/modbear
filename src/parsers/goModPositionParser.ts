import type {
  GoModReplacement,
  GoModRequirement,
  ParsedGoMod
} from "../domain/dependency";
import type { TextRange } from "../domain/module";

function range(line: number, start: number, value: string): TextRange {
  return {
    start: { line, character: start },
    end: { line, character: start + value.length }
  };
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function isLocalReplacement(value: string): boolean {
  return value.startsWith("./") || value.startsWith("../") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function parseGoModPositions(text: string): ParsedGoMod {
  const requirements: GoModRequirement[] = [];
  const replacements: GoModReplacement[] = [];
  const lines = text.split(/\r?\n/);
  let inRequireBlock = false;
  let moduleDirective: ParsedGoMod["module"];
  let goDirective: ParsedGoMod["go"];
  let toolchainDirective: ParsedGoMod["toolchain"];

  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    if (/^require\s*\($/.test(trimmed)) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && trimmed === ")") {
      inRequireBlock = false;
      continue;
    }

    const moduleMatch = /^(\s*)module\s+("[^"]+"|\S+)/.exec(raw);
    if (moduleMatch) {
      const token = moduleMatch[2] ?? "";
      const start = raw.indexOf(token);
      moduleDirective = { path: unquote(token), range: range(line, start, token) };
      continue;
    }

    const goMatch = /^(\s*)go\s+(\S+)/.exec(raw);
    if (goMatch) {
      const token = goMatch[2] ?? "";
      goDirective = { version: token, range: range(line, raw.indexOf(token), token) };
      continue;
    }

    const toolchainMatch = /^(\s*)toolchain\s+(\S+)/.exec(raw);
    if (toolchainMatch) {
      const token = toolchainMatch[2] ?? "";
      toolchainDirective = { version: token, range: range(line, raw.indexOf(token), token) };
      continue;
    }

    const requirementPattern = inRequireBlock
      ? /^(\s*)("[^"]+"|\S+)\s+(v\S+)/
      : /^(\s*)require\s+("[^"]+"|\S+)\s+(v\S+)/;
    const requirementMatch = requirementPattern.exec(raw);
    if (requirementMatch) {
      const moduleToken = requirementMatch[2] ?? "";
      const versionToken = requirementMatch[3] ?? "";
      requirements.push({
        modulePath: unquote(moduleToken),
        version: versionToken,
        indirect: /\/\/\s*indirect\b/.test(raw),
        line,
        moduleRange: range(line, raw.indexOf(moduleToken), moduleToken),
        versionRange: range(line, raw.indexOf(versionToken), versionToken)
      });
      continue;
    }

    const replaceMatch = /^(\s*)replace\s+(\S+)(?:\s+(v\S+))?\s+=>\s+(\S+)(?:\s+(v\S+))?/.exec(raw);
    if (replaceMatch) {
      const oldPath = unquote(replaceMatch[2] ?? "");
      const oldVersion = replaceMatch[3];
      const newPath = unquote(replaceMatch[4] ?? "");
      const newVersion = replaceMatch[5];
      replacements.push({
        oldPath,
        ...(oldVersion ? { oldVersion } : {}),
        newPath,
        ...(newVersion ? { newVersion } : {}),
        local: isLocalReplacement(newPath),
        line,
        range: range(line, raw.indexOf(newPath), newPath)
      });
    }
  }

  return {
    ...(moduleDirective ? { module: moduleDirective } : {}),
    ...(goDirective ? { go: goDirective } : {}),
    ...(toolchainDirective ? { toolchain: toolchainDirective } : {}),
    requirements,
    replacements
  };
}
