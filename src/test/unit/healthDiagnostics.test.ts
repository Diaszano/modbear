import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Diagnostic } from "vscode";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import type { ParsedGoMod } from "../../domain/dependency";
import type { mergeHealthDiagnostics } from "../../diagnostics/healthDiagnostics";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface FakePosition {
  readonly line: number;
  readonly character: number;
}

interface FakeRange {
  readonly start: FakePosition;
  readonly end: FakePosition;
}

function codeText(code: Diagnostic["code"]): string {
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

async function loadMergeHealthDiagnostics(): Promise<typeof mergeHealthDiagnostics> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
        Range: class implements FakeRange {
          public readonly start: FakePosition;
          public readonly end: FakePosition;
          public constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
            this.start = { line: startLine, character: startCharacter };
            this.end = { line: endLine, character: endCharacter };
          }
        },
        Diagnostic: class {
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
    return (await import("../../diagnostics/healthDiagnostics.js")).mergeHealthDiagnostics;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

function rangeAt(line: number): { start: FakePosition; end: FakePosition } {
  return { start: { line, character: 0 }, end: { line, character: 40 } };
}

function buildParsedGoMod(): ParsedGoMod {
  return {
    module: { path: "example.com/app", range: rangeAt(0) },
    go: { version: "1.23", range: rangeAt(1) },
    requirements: [
      {
        modulePath: "example.com/library",
        version: "v1.0.0",
        indirect: false,
        line: 3,
        moduleRange: rangeAt(3),
        versionRange: rangeAt(3),
      },
    ],
    replacements: [
      {
        oldPath: "example.com/old",
        newPath: "../local/old",
        local: true,
        line: 5,
        range: rangeAt(5),
      },
    ],
  };
}

function buildSnapshot(): ModuleAnalysisSnapshot {
  return {
    moduleId: "/workspace/app",
    contentHash: "fixture",
    createdAt: new Date(0).toISOString(),
    stale: false,
    updateState: "complete",
    dependencies: [
      {
        modulePath: "example.com/library",
        installedVersion: "v1.0.0",
        availableVersion: "v1.1.0",
        updateKind: "minor",
        retractionRationales: [],
        errors: [],
      },
    ],
    replacements: [{ sourcePath: "example.com/old", targetPath: "../local/old", local: true, exists: false }],
    vulnerabilities: {
      state: "complete",
      findings: [
        {
          osvId: "GO-2026-0001",
          fixedVersion: "v1.2.3",
          classification: "reachable",
          trace: [{ module: "example.com/library", version: "v1.0.0" }],
        },
      ],
      advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Unsafe parsing" } },
      errors: [],
    },
    tidy: { state: "complete", consistent: false, diff: "diff current/go.mod tidy/go.mod\n", errors: [] },
    toolchain: { state: "complete", installed: "go1.21.5", errors: [] },
    errors: [],
  };
}

test("merges update, replacement, vulnerability, tidy, and toolchain diagnostics into one collection", async () => {
  const mergeHealthDiagnostics = await loadMergeHealthDiagnostics();
  const diagnostics = mergeHealthDiagnostics(buildParsedGoMod(), buildSnapshot(), "warning");

  const codes = diagnostics.map((diagnostic) => codeText(diagnostic.code));
  assert.ok(codes.includes("update-available"), "update contribution missing");
  assert.ok(codes.includes("missing-local-replacement"), "replacement contribution missing");
  assert.ok(codes.includes("GO-2026-0001"), "vulnerability contribution missing");
  assert.ok(codes.includes("tidy-diff"), "tidy contribution missing");
  assert.ok(codes.includes("go-version"), "toolchain contribution missing");
});

test("keeps every contribution anchored on its own directive range", async () => {
  const mergeHealthDiagnostics = await loadMergeHealthDiagnostics();
  const parsed = buildParsedGoMod();
  const diagnostics = mergeHealthDiagnostics(parsed, buildSnapshot(), "warning");

  const byCode = new Map(diagnostics.map((diagnostic) => [codeText(diagnostic.code), diagnostic] as const));
  assert.deepEqual(byCode.get("tidy-diff")?.range.start, parsed.module!.range.start);
  assert.deepEqual(byCode.get("go-version")?.range.start, parsed.go!.range.start);
  assert.deepEqual(byCode.get("update-available")?.range.start, parsed.requirements[0]!.versionRange.start);
  assert.equal(byCode.get("GO-2026-0001")?.severity, 0);
});

test("omits health contributions when the snapshot lacks tidy or toolchain results", async () => {
  const mergeHealthDiagnostics = await loadMergeHealthDiagnostics();
  const snapshot = buildSnapshot();
  const reduced: ModuleAnalysisSnapshot = {
    moduleId: snapshot.moduleId,
    contentHash: snapshot.contentHash,
    createdAt: snapshot.createdAt,
    stale: false,
    updateState: "complete",
    dependencies: snapshot.dependencies,
    replacements: snapshot.replacements,
    vulnerabilities: snapshot.vulnerabilities,
    errors: [],
  };
  const diagnostics = mergeHealthDiagnostics(buildParsedGoMod(), reduced, "warning");

  const codes = diagnostics.map((diagnostic) => codeText(diagnostic.code));
  assert.ok(!codes.includes("tidy-diff"));
  assert.ok(!codes.includes("go-version"));
  assert.ok(!codes.includes("toolchain-unavailable"));
  assert.ok(codes.includes("update-available"));
});
