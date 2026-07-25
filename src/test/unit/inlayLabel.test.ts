import assert from "node:assert/strict";
import test from "node:test";
import { buildInlayLabel } from "../../providers/inlayLabel";

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
