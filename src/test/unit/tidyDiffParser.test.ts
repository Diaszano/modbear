import assert from "node:assert/strict";
import test from "node:test";
import { classifyTidyResult } from "../../parsers/tidyDiffParser";

test("classifies only a unified diff as inconsistent", () => {
  const diff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";
  assert.deepEqual(classifyTidyResult(1, diff, ""), { kind: "diff", diff });
});

test("does not misclassify package-loading errors as diffs", () => {
  assert.deepEqual(classifyTidyResult(1, "", "go: missing: no matching versions"), {
    kind: "error",
    message: "go: missing: no matching versions"
  });
});
