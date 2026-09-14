import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { DependencyStatus } from "../../domain/analysis";
import type { VulnerabilityFinding } from "../../domain/vulnerability";

const nodeRequire = createRequire(__filename);
const moduleLoader = nodeRequire("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {
      EventEmitter: class {},
      InlayHint: class {},
      InlayHintKind: { Type: 1 },
      InlayHintLabelPart: class {},
      MarkdownString: class {},
      Position: class {},
      workspace: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { buildInlayLabel } = nodeRequire(
  "../../providers/dependencyInlayHintsProvider",
) as typeof import("../../providers/dependencyInlayHintsProvider");

function baseStatus(overrides: Partial<DependencyStatus> = {}): DependencyStatus {
  return {
    modulePath: "a",
    installedVersion: "v1.0.0",
    retractionRationales: [],
    errors: [],
    ...overrides,
  };
}

test("prioritizes a reachable vulnerability over every other label", () => {
  const finding = {
    osvId: "GO-2026-0001",
    fixedVersion: "v1.2.3",
    classification: "reachable",
    trace: [],
  } as unknown as VulnerabilityFinding;
  assert.equal(
    buildInlayLabel(
      baseStatus({
        availableVersion: "v1.1.0",
        updateKind: "minor",
        deprecatedMessage: "use b",
        retractionRationales: ["bad"],
      }),
      true,
      [finding],
    ),
    "🛡 fixed in v1.2.3",
  );
});

test("marks a reachable vulnerability without a fix", () => {
  const finding = { classification: "reachable", trace: [] } as unknown as VulnerabilityFinding;
  assert.equal(buildInlayLabel(baseStatus({ availableVersion: "v1.1.0" }), true, [finding]), "🛡 vulnerable · no fix");
});

test("keeps lifecycle labels when findings are only imported or module-only", () => {
  const imported = { classification: "imported", trace: [] } as unknown as VulnerabilityFinding;
  const moduleOnly = { classification: "module-only", trace: [] } as unknown as VulnerabilityFinding;
  assert.equal(
    buildInlayLabel(baseStatus({ availableVersion: "v1.1.0", updateKind: "minor" }), true, [imported, moduleOnly]),
    "→ v1.1.0 · minor",
  );
});

test("prefers the earliest fixed vulnerable version among reachable findings", () => {
  const fixed = { classification: "reachable", fixedVersion: "v1.2.3", trace: [] } as unknown as VulnerabilityFinding;
  const unfixed = { classification: "reachable", trace: [] } as unknown as VulnerabilityFinding;
  assert.equal(buildInlayLabel(baseStatus(), true, [unfixed, fixed]), "🛡 fixed in v1.2.3");
});

test("prioritizes retraction over update", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        availableVersion: "v1.1.0",
        updateKind: "minor",
        retractionRationales: ["bad"],
        errors: [],
      },
      true,
    ),
    "⚠ retracted · → v1.1.0",
  );
});

test("shows retraction without available update", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        retractionRationales: ["bad"],
        errors: [],
      },
      true,
    ),
    "⚠ retracted",
  );
});

test("shows deprecation status when deprecated", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        deprecatedMessage: "use b instead",
        retractionRationales: [],
        errors: [],
      },
      true,
    ),
    "⚠ deprecated",
  );
});

test("shows compatible update", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        availableVersion: "v1.0.1",
        updateKind: "patch",
        retractionRationales: [],
        errors: [],
      },
      true,
    ),
    "→ v1.0.1 · patch",
  );
});

test("shows compatible update without updateKind when showKind is false", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        availableVersion: "v1.0.1",
        updateKind: "patch",
        retractionRationales: [],
        errors: [],
      },
      false,
    ),
    "→ v1.0.1",
  );
});

test("shows local replacement when applicable", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        retractionRationales: [],
        replacement: {
          sourcePath: "a",
          targetPath: "../local/a",
          local: true,
        },
        errors: [],
      },
      true,
    ),
    "↪ local replacement",
  );
});

test("returns undefined when no hint applies", () => {
  assert.equal(
    buildInlayLabel(
      {
        modulePath: "a",
        installedVersion: "v1.0.0",
        retractionRationales: [],
        errors: [],
      },
      true,
    ),
    undefined,
  );
});
