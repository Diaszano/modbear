import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { ToolchainAnalysis } from "../../domain/analysis";
import type { ParsedGoMod } from "../../domain/dependency";
import type { TextRange } from "../../domain/module";
import type { mapToolchainDiagnostics } from "../../diagnostics/toolchainDiagnosticMapper";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface FakePosition {
  readonly line: number;
  readonly character: number;
}

interface FakeRange {
  readonly start: FakePosition;
  readonly end: FakePosition;
}

interface FakeDiagnostic {
  range: FakeRange;
  message: string;
  severity: number;
  source?: string;
  code?: string | number;
}

async function loadMapToolchainDiagnostics(): Promise<typeof mapToolchainDiagnostics> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        DiagnosticSeverity: { Error: 0, Warning: 1 },
        Range: class implements FakeRange {
          public readonly start: FakePosition;
          public readonly end: FakePosition;
          public constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
            this.start = { line: startLine, character: startCharacter };
            this.end = { line: endLine, character: endCharacter };
          }
        },
        Diagnostic: class implements FakeDiagnostic {
          public source?: string;
          public code?: string | number;
          public constructor(
            public range: FakeRange,
            public message: string,
            public severity: number,
          ) {}
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return (await import("../../diagnostics/toolchainDiagnosticMapper.js")).mapToolchainDiagnostics;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

function textRange(line: number): TextRange {
  return { start: { line, character: 0 }, end: { line, character: 12 } };
}

function withOnlyGo(parsed: ParsedGoMod): ParsedGoMod {
  return {
    ...(parsed.go ? { go: parsed.go } : {}),
    requirements: parsed.requirements,
    replacements: parsed.replacements,
  };
}

function withoutToolchain(parsed: ParsedGoMod): ParsedGoMod {
  return {
    ...(parsed.module ? { module: parsed.module } : {}),
    ...(parsed.go ? { go: parsed.go } : {}),
    requirements: parsed.requirements,
    replacements: parsed.replacements,
  };
}

const parsedDirectives: ParsedGoMod = {
  module: { path: "example.com/mod", range: textRange(0) },
  go: { version: "1.23", range: textRange(3) },
  toolchain: { version: "go1.24.0", range: textRange(5) },
  requirements: [],
  replacements: [],
};

const belowGo: ToolchainAnalysis = {
  state: "complete",
  installed: "go1.21.5",
  required: "1.23",
  suggested: "go1.24.0",
  errors: [],
};

const belowSuggested: ToolchainAnalysis = {
  state: "complete",
  installed: "go1.23.5",
  required: "1.23",
  suggested: "go1.24.0",
  errors: [],
};

const unavailable: ToolchainAnalysis = {
  state: "failed",
  errors: [{ code: "tool-not-found", message: "Failed to start go" }],
};

test("reports an error on the go directive when the installed version is older", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const diagnostics = mapToolchainDiagnostics(parsedDirectives, belowGo);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0]?.severity, 0);
  assert.equal(diagnostics[0]?.code, "go-version");
  assert.equal(diagnostics[0]?.source, "modbear");
  assert.deepEqual(diagnostics[0]?.range.start, parsedDirectives.go!.range.start);
  assert.deepEqual(diagnostics[0]?.range.end, parsedDirectives.go!.range.end);
  assert.equal(diagnostics[1]?.severity, 1);
  assert.equal(diagnostics[1]?.code, "toolchain-version");
});

test("warns on the toolchain directive when only the suggestion is newer", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const diagnostics = mapToolchainDiagnostics(parsedDirectives, belowSuggested);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.severity, 1);
  assert.equal(diagnostics[0]?.code, "toolchain-version");
  assert.equal(diagnostics[0]?.source, "modbear");
  assert.deepEqual(diagnostics[0]?.range.start, parsedDirectives.toolchain!.range.start);
});

test("maps a satisfied toolchain to no diagnostics", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const satisfied: ToolchainAnalysis = {
    state: "complete",
    installed: "go1.25.1",
    required: "1.23",
    suggested: "go1.24.0",
    errors: [],
  };
  const boundary: ToolchainAnalysis = { ...satisfied, installed: "go1.24.0" };
  const exactRequired: ToolchainAnalysis = { state: "complete", installed: "go1.23", required: "1.23", errors: [] };
  assert.deepEqual(mapToolchainDiagnostics(parsedDirectives, satisfied), []);
  assert.deepEqual(mapToolchainDiagnostics(parsedDirectives, boundary), []);
  assert.deepEqual(mapToolchainDiagnostics(withoutToolchain(parsedDirectives), exactRequired), []);
});

test("anchors an unavailable analysis on the module directive", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const diagnostics = mapToolchainDiagnostics(parsedDirectives, unavailable);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "toolchain-unavailable");
  assert.equal(diagnostics[0]?.source, "modbear");
  assert.equal(diagnostics[0]?.range.start.line, parsedDirectives.module!.range.start.line);
});

test("skips unavailable analyses without a module directive to anchor on", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const parsedWithoutModule: ParsedGoMod = withOnlyGo(parsedDirectives);
  assert.deepEqual(mapToolchainDiagnostics(parsedWithoutModule, unavailable), []);
  assert.deepEqual(mapToolchainDiagnostics(parsedWithoutModule, undefined), []);
});

test("reports malformed directives at their own ranges", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const malformedGo: ParsedGoMod = { ...parsedDirectives, go: { version: "1.x", range: textRange(3) } };
  const goDiagnostics = mapToolchainDiagnostics(malformedGo, {
    state: "complete",
    installed: "go1.25.1",
    errors: [],
  });
  assert.equal(goDiagnostics[0]?.severity, 0);
  assert.equal(goDiagnostics[0]?.code, "go-version");
  assert.deepEqual(goDiagnostics[0]?.range.start, malformedGo.go!.range.start);

  const malformedToolchain: ParsedGoMod = {
    ...parsedDirectives,
    toolchain: { version: "go1.x", range: textRange(5) },
  };
  const toolchainDiagnostics = mapToolchainDiagnostics(malformedToolchain, {
    state: "complete",
    installed: "go1.25.1",
    errors: [],
  });
  assert.equal(toolchainDiagnostics[0]?.severity, 1);
  assert.equal(toolchainDiagnostics[0]?.code, "toolchain-version");
  assert.deepEqual(toolchainDiagnostics[0]?.range.start, malformedToolchain.toolchain!.range.start);

  const bothMalformed: ParsedGoMod = {
    ...parsedDirectives,
    go: { version: "1.x", range: textRange(3) },
    toolchain: { version: "go1.x", range: textRange(5) },
  };
  const combined = mapToolchainDiagnostics(bothMalformed, { state: "complete", installed: "go1.25.1", errors: [] });
  assert.deepEqual(
    combined.map((diagnostic) => diagnostic.code),
    ["go-version", "toolchain-version"],
  );
});

test("treats a complete analysis without a parsable installed version as unavailable", async () => {
  const mapToolchainDiagnostics = await loadMapToolchainDiagnostics();
  const emptyInstalled: ToolchainAnalysis = { state: "complete", errors: [] };
  const garbageInstalled: ToolchainAnalysis = { state: "complete", installed: "devel", errors: [] };
  for (const analysis of [emptyInstalled, garbageInstalled]) {
    const diagnostics = mapToolchainDiagnostics(parsedDirectives, analysis);
    assert.equal(diagnostics[0]?.code, "toolchain-unavailable");
    assert.equal(diagnostics[0]?.range.start.line, parsedDirectives.module!.range.start.line);
  }
});
