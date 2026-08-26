import assert from "node:assert/strict";
import test from "node:test";
import { classifyTidyResult } from "../../parsers/tidyDiffParser";

const unifiedDiff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";

test("classifies only a unified diff as inconsistent", () => {
  assert.deepEqual(classifyTidyResult(1, unifiedDiff, ""), { kind: "diff", diff: unifiedDiff });
});

test("does not misclassify package-loading errors as diffs", () => {
  assert.deepEqual(classifyTidyResult(1, "", "go: missing: no matching versions"), {
    kind: "error",
    message: "go: missing: no matching versions",
  });
});

test("classifies a silent zero exit as clean", () => {
  assert.deepEqual(classifyTidyResult(0, "", ""), { kind: "clean" });
  assert.deepEqual(classifyTidyResult(0, "\n", "  \n"), { kind: "clean" });
});

test("prefers the unified diff shape over the exit code", () => {
  assert.deepEqual(classifyTidyResult(0, unifiedDiff, ""), { kind: "diff", diff: unifiedDiff });
});

test("does not treat truncated diff headers as inconsistencies", () => {
  const partial = "--- current/go.mod\n+++ tidy/go.mod\n";
  assert.deepEqual(classifyTidyResult(1, partial, ""), {
    kind: "error",
    message: partial.trim(),
  });
});

test("falls back to stdout for a zero exit with unexpected output", () => {
  assert.deepEqual(classifyTidyResult(0, "unexpected banner\n", ""), {
    kind: "error",
    message: "unexpected banner",
  });
});

test("prefers stderr over stdout in error messages", () => {
  assert.deepEqual(classifyTidyResult(1, "partial output", "go: example.com/x: cannot find module"), {
    kind: "error",
    message: "go: example.com/x: cannot find module",
  });
});

test("describes a signal-terminated run without output", () => {
  assert.deepEqual(classifyTidyResult(null, "", ""), { kind: "error", message: "go mod tidy -diff exited null" });
});
