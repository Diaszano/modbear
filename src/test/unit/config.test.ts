import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

async function loadReadConfig(get: (key: string, fallback: unknown) => unknown): Promise<typeof import("../../config/config").readConfig> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    return request === "vscode"
      ? { workspace: { getConfiguration: () => ({ get }) } }
      : originalLoad.call(this, request, parent, isMain);
  };

  try {
    return (await import("../../config/config.js")).readConfig;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("readConfig reads the current log level and falls back from invalid runtime values", async () => {
  const configured = new Map<string, unknown>([["output.logLevel", "invalid"]]);
  const readConfig = await loadReadConfig((key, fallback) => configured.get(key) ?? fallback);

  for (const invalidLevel of ["invalid", 1, false, null]) {
    configured.set("output.logLevel", invalidLevel);
    assert.equal(readConfig().logLevel, "info");
  }

  configured.set("output.logLevel", "debug");
  assert.equal(readConfig().logLevel, "debug");

  configured.set("vulnerability.buildTags", ["integration", "linux"]);
  configured.set("vulnerability.database", "https://vuln.example.test");
  configured.set("diagnostics.importedVulnerabilitySeverity", "information");
  assert.deepEqual(readConfig().vulnerabilityBuildTags, ["integration", "linux"]);
  assert.equal(readConfig().vulnerabilityDatabase, "https://vuln.example.test");
  assert.equal(readConfig().importedVulnerabilitySeverity, "information");

  configured.set("vulnerability.buildTags", ["invalid tag"]);
  configured.set("vulnerability.database", "https://user:secret@vuln.example.test");
  configured.set("diagnostics.importedVulnerabilitySeverity", "invalid");
  assert.deepEqual(readConfig().vulnerabilityBuildTags, []);
  assert.equal(readConfig().vulnerabilityDatabase, "");
  assert.equal(readConfig().importedVulnerabilitySeverity, "warning");

  configured.set("vulnerability.buildTags", ["integration", "integration"]);
  configured.set("vulnerability.database", "http://vuln.example.test");
  assert.deepEqual(readConfig().vulnerabilityBuildTags, []);
  assert.equal(readConfig().vulnerabilityDatabase, "");
});
