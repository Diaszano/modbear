import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { TidyAnalysis } from "../../domain/analysis";
import type { ParsedGoMod } from "../../domain/dependency";
import type { mapTidyDiagnostic } from "../../diagnostics/tidyDiagnosticMapper";

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

async function loadMapTidyDiagnostic(): Promise<typeof mapTidyDiagnostic> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        DiagnosticSeverity: { Warning: 1 },
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
    return (await import("../../diagnostics/tidyDiagnosticMapper.js")).mapTidyDiagnostic;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

const parsedWithModule: ParsedGoMod = {
  module: {
    path: "example.com/mod",
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 20 } },
  },
  requirements: [],
  replacements: [],
};

const parsedWithoutModule: ParsedGoMod = { requirements: [], replacements: [] };

const inconsistent: TidyAnalysis = { state: "complete", consistent: false, diff: "diff", errors: [] };

test("anchors a tidy-diff warning on the module directive", async () => {
  const mapTidyDiagnostic = await loadMapTidyDiagnostic();
  const diagnostic = mapTidyDiagnostic(parsedWithModule, inconsistent);
  assert.ok(diagnostic);
  assert.equal(diagnostic.code, "tidy-diff");
  assert.equal(diagnostic.source, "modbear");
  assert.equal(diagnostic.severity, 1);
  assert.deepEqual(diagnostic.range.start, parsedWithModule.module!.range.start);
  assert.deepEqual(diagnostic.range.end, parsedWithModule.module!.range.end);
  assert.match(diagnostic.message, /tidy/);
});

test("maps only complete inconsistent results for modules with a directive", async () => {
  const mapTidyDiagnostic = await loadMapTidyDiagnostic();
  const clean: TidyAnalysis = { state: "complete", consistent: true, errors: [] };
  const failed: TidyAnalysis = {
    state: "failed",
    consistent: false,
    errors: [{ code: "timeout", message: "timed out" }],
  };
  assert.equal(mapTidyDiagnostic(parsedWithModule, undefined), undefined);
  assert.equal(mapTidyDiagnostic(parsedWithModule, clean), undefined);
  assert.equal(mapTidyDiagnostic(parsedWithModule, failed), undefined);
  assert.equal(mapTidyDiagnostic(parsedWithoutModule, inconsistent), undefined);
});
