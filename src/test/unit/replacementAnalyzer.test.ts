import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeReplacement } from "../../analyzers/replacementAnalyzer";

test("records source coordinates and reports a missing local replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gdh-replace-"));
  const status = await analyzeReplacement(root, {
    oldPath: "example.com/old",
    newPath: "../missing",
    local: true,
    line: 0,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 37 } }
  });
  assert.equal(status.sourcePath, "example.com/old");
  assert.equal(status.local, true);
  assert.equal(status.exists, false);
});

test("reports an existing local replacement", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gdh-replace-"));
  const root = path.join(parent, "app");
  const local = path.join(parent, "local");
  await mkdir(root);
  await mkdir(local);
  const status = await analyzeReplacement(root, {
    oldPath: "example.com/old",
    newPath: "../local",
    local: true,
    line: 0,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 35 } }
  });
  assert.equal(status.exists, true);
});

test("local replacements suppress unsupported update claims for the original module", async () => {
  const { attachReplacementStatuses } = await import("../../analyzers/replacementAnalyzer.js");
  const dependencies = [{
    modulePath: "example.com/old",
    installedVersion: "v1.0.0",
    availableVersion: "v1.1.0",
    updateKind: "minor" as const,
    deprecatedMessage: "old message",
    retractionRationales: ["old rationale"],
    errors: []
  }];
  const replacements = [{
    sourcePath: "example.com/old",
    targetPath: "/tmp/local",
    local: true,
    exists: true
  }];
  assert.deepEqual(attachReplacementStatuses(dependencies, replacements), [{
    modulePath: "example.com/old",
    installedVersion: "v1.0.0",
    retractionRationales: [],
    replacement: replacements[0],
    errors: []
  }]);
});
