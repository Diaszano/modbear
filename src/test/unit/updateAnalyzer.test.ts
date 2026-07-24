import assert from "node:assert/strict";
import test from "node:test";
import { analyzeUpdateOutput } from "../../analyzers/updateAnalyzer";

const requirements = [{
  modulePath: "example.com/a",
  version: "v1.0.0",
  indirect: false,
  line: 0,
  moduleRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 13 } },
  versionRange: { start: { line: 0, character: 14 }, end: { line: 0, character: 20 } }
}];

test("maps update, deprecation, and retraction fields", () => {
  const statuses = analyzeUpdateOutput(requirements, [{
    Path: "example.com/a",
    Version: "v1.0.0",
    Update: { Path: "example.com/a", Version: "v1.2.0" },
    Deprecated: "use example.com/b",
    Retracted: ["contains a severe bug"]
  }]);
  assert.deepEqual(statuses[0], {
    modulePath: "example.com/a",
    installedVersion: "v1.0.0",
    availableVersion: "v1.2.0",
    updateKind: "minor",
    deprecatedMessage: "use example.com/b",
    retractionRationales: ["contains a severe bug"],
    errors: []
  });
});

test("builds the immutable go list argument contract", async () => {
  const { buildGoListArgs } = await import("../../analyzers/updateAnalyzer.js");
  assert.deepEqual(buildGoListArgs(), ["list", "-m", "-u", "-json", "-mod=readonly", "all"]);
  assert.deepEqual(
    buildGoListArgs(requirements),
    ["list", "-m", "-u", "-json", "-mod=readonly", "example.com/a"]
  );
});

test("builds targeted go list arguments when requirements are present", async () => {
  const { buildGoListArgs } = await import("../../analyzers/updateAnalyzer.js");
  const testRequirements = [
    {
      modulePath: "example.com/a",
      version: "v1.0.0",
      indirect: false,
      line: 0,
      moduleRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 13 } },
      versionRange: { start: { line: 0, character: 14 }, end: { line: 0, character: 20 } }
    },
    {
      modulePath: "example.com/b",
      version: "v2.0.0",
      indirect: true,
      line: 1,
      moduleRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 13 } },
      versionRange: { start: { line: 1, character: 14 }, end: { line: 1, character: 20 } }
    }
  ];
  assert.deepEqual(buildGoListArgs(testRequirements), [
    "list",
    "-m",
    "-u",
    "-json",
    "-mod=readonly",
    "example.com/a",
    "example.com/b"
  ]);
});

test("analyzeUpdates returns empty array immediately if requirements is empty", async () => {
  const { analyzeUpdates } = await import("../../analyzers/updateAnalyzer.js");
  const result = await analyzeUpdates({
    module: {
      id: "dummy",
      moduleRoot: "/dummy",
      goModPath: "/dummy/go.mod"
    },
    requirements: [],
    goExecutable: "invalid-executable-that-would-fail",
    timeoutMs: 1000,
    signal: new AbortController().signal
  });
  assert.deepEqual(result, []);
});

