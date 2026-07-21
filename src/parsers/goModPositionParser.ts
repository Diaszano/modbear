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
  let inReplaceBlock = false;
  let moduleDirective: ParsedGoMod["module"];
  let goDirective: ParsedGoMod["go"];
  let toolchainDirective: ParsedGoMod["toolchain"];

  for (let line = 0; line < lines.length; line += 1) {
    const raw = lines[line] ?? "";
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    if (/^require\s*\(\s*(?:\/\/.*)?$/.test(trimmed)) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && trimmed === ")") {
      inRequireBlock = false;
      continue;
    }

    if (/^replace\s*\(\s*(?:\/\/.*)?$/.test(trimmed)) {
      inReplaceBlock = true;
      continue;
    }
    if (inReplaceBlock && trimmed === ")") {
      inReplaceBlock = false;
      continue;
    }

    const moduleMatch = /^(\s*)module\s+("[^"]+"|\S+)/.exec(raw);
    if (moduleMatch) {
      const token = moduleMatch[2] ?? "";
      const searchStart = (moduleMatch.index ?? 0) + (moduleMatch[1]?.length ?? 0) + "module".length;
      const start = raw.indexOf(token, searchStart);
      moduleDirective = { path: unquote(token), range: range(line, start, token) };
      continue;
    }

    const goMatch = /^(\s*)go\s+(\S+)/.exec(raw);
    if (goMatch) {
      const token = goMatch[2] ?? "";
      const searchStart = (goMatch.index ?? 0) + (goMatch[1]?.length ?? 0) + "go".length;
      const start = raw.indexOf(token, searchStart);
      goDirective = { version: token, range: range(line, start, token) };
      continue;
    }

    const toolchainMatch = /^(\s*)toolchain\s+(\S+)/.exec(raw);
    if (toolchainMatch) {
      const token = toolchainMatch[2] ?? "";
      const searchStart = (toolchainMatch.index ?? 0) + (toolchainMatch[1]?.length ?? 0) + "toolchain".length;
      const start = raw.indexOf(token, searchStart);
      toolchainDirective = { version: token, range: range(line, start, token) };
      continue;
    }

    const requirementPattern = inRequireBlock
      ? /^(\s*)("[^"]+"|\S+)\s+(v\S+)/
      : /^(\s*)require\s+("[^"]+"|\S+)\s+(v\S+)/;
    const requirementMatch = requirementPattern.exec(raw);
    if (requirementMatch) {
      const moduleToken = requirementMatch[2] ?? "";
      const versionToken = requirementMatch[3] ?? "";
      let searchStart = (requirementMatch.index ?? 0) + (requirementMatch[1]?.length ?? 0);
      if (!inRequireBlock) {
        searchStart += "require".length;
      }
      const moduleStart = raw.indexOf(moduleToken, searchStart);
      const versionStart = raw.indexOf(versionToken, moduleStart + moduleToken.length);

      requirements.push({
        modulePath: unquote(moduleToken),
        version: versionToken,
        indirect: /\/\/\s*indirect\b/.test(raw),
        line,
        moduleRange: range(line, moduleStart, moduleToken),
        versionRange: range(line, versionStart, versionToken)
      });
      continue;
    }

    const replacePattern = inReplaceBlock
      ? /^(\s*)("[^"]+"|\S+)(?:\s+(v\S+))?\s+=>\s+("[^"]+"|\S+)(?:\s+(v\S+))?/
      : /^(\s*)replace\s+("[^"]+"|\S+)(?:\s+(v\S+))?\s+=>\s+("[^"]+"|\S+)(?:\s+(v\S+))?/;
    const replaceMatch = replacePattern.exec(raw);
    if (replaceMatch) {
      const oldPathToken = replaceMatch[2] ?? "";
      const oldVersion = replaceMatch[3];
      const newPathToken = replaceMatch[4] ?? "";
      const newVersion = replaceMatch[5];

      let searchStart = (replaceMatch.index ?? 0) + (replaceMatch[1]?.length ?? 0);
      if (!inReplaceBlock) {
        searchStart += "replace".length;
      }
      const oldPathStart = raw.indexOf(oldPathToken, searchStart);
      searchStart = oldPathStart + oldPathToken.length;
      if (oldVersion) {
        const oldVerStart = raw.indexOf(oldVersion, searchStart);
        searchStart = oldVerStart + oldVersion.length;
      }
      const arrowStart = raw.indexOf("=>", searchStart);
      searchStart = arrowStart + "=>".length;
      const newPathStart = raw.indexOf(newPathToken, searchStart);

      const oldPath = unquote(oldPathToken);
      const newPath = unquote(newPathToken);

      replacements.push({
        oldPath,
        ...(oldVersion ? { oldVersion } : {}),
        newPath,
        ...(newVersion ? { newVersion } : {}),
        local: isLocalReplacement(newPath),
        line,
        range: range(line, newPathStart, newPathToken)
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
