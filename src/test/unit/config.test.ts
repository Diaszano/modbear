import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { readConfig } from "../../config/config";
import { DEFAULTS } from "../../config/defaults";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface ConfigModule {
  readConfig: typeof readConfig;
}

async function loadReadConfig(get: (key: string, fallback: unknown) => unknown): Promise<typeof readConfig> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    return request === "vscode"
      ? { workspace: { getConfiguration: () => ({ get }) } }
      : originalLoad.call(this, request, parent, isMain);
  };

  try {
    nodeRequire.cache[nodeRequire.resolve("../../config/config.js")] = undefined;
    return (nodeRequire("../../config/config.js") as ConfigModule).readConfig;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("readConfig reads the current log level and falls back from invalid runtime values", async () => {
  let configuredLevel: unknown = "invalid";
  const readConfig = await loadReadConfig((key, fallback) => (key === "output.logLevel" ? configuredLevel : fallback));

  for (const invalidLevel of ["invalid", 1, false, null]) {
    configuredLevel = invalidLevel;
    assert.equal(readConfig().logLevel, "info");
  }

  configuredLevel = "debug";
  assert.equal(readConfig().logLevel, "debug");
});

test("readConfig applies documented defaults for health phase settings", async () => {
  const readConfig = await loadReadConfig((_key, fallback) => fallback);
  const config = readConfig();
  assert.equal(config.tidyEnabled, DEFAULTS.tidyEnabled);
  assert.equal(config.tidyTtlMinutes, DEFAULTS.tidyTtlMinutes);
  assert.equal(config.vulnerabilityTtlMinutes, DEFAULTS.vulnerabilityTtlMinutes);
  assert.equal(config.importedVulnerabilitySeverity, DEFAULTS.importedVulnerabilitySeverity);
  assert.equal(config.vulnerabilityIncludeTests, DEFAULTS.vulnerabilityIncludeTests);
  assert.deepEqual(config.vulnerabilityBuildTags, DEFAULTS.vulnerabilityBuildTags);
  assert.equal(config.vulnerabilityDatabase, DEFAULTS.vulnerabilityDatabase);
});

test("readConfig parses health settings and falls back from invalid runtime values", async () => {
  let overrides: Record<string, unknown> = {
    "tidy.enabled": false,
    "scan.tidyTtlMinutes": 45,
    "scan.vulnerabilityTtlMinutes": 720,
    "diagnostics.importedVulnerabilitySeverity": "error",
    "vulnerability.includeTests": true,
    "vulnerability.buildTags": ["integration"],
    "vulnerability.database": "https://example.test/db",
  };
  const readConfig = await loadReadConfig((key, fallback) => (key in overrides ? overrides[key] : fallback));

  const config = readConfig();
  assert.equal(config.tidyEnabled, false);
  assert.equal(config.tidyTtlMinutes, 45);
  assert.equal(config.vulnerabilityTtlMinutes, 720);
  assert.equal(config.importedVulnerabilitySeverity, "error");
  assert.equal(config.vulnerabilityIncludeTests, true);
  assert.deepEqual(config.vulnerabilityBuildTags, ["integration"]);
  assert.equal(config.vulnerabilityDatabase, "https://example.test/db");

  overrides = {
    "diagnostics.importedVulnerabilitySeverity": "bogus",
    "vulnerability.buildTags": "not-an-array",
  };
  const fallbackConfig = readConfig();
  assert.equal(fallbackConfig.importedVulnerabilitySeverity, DEFAULTS.importedVulnerabilitySeverity);
  assert.deepEqual(fallbackConfig.vulnerabilityBuildTags, DEFAULTS.vulnerabilityBuildTags);
});

test("package.json contributes health settings matching runtime defaults", async () => {
  const nodeRequire = createRequire(__filename);
  const manifest = nodeRequire("../../../package.json") as {
    contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
  };
  const properties = manifest.contributes.configuration.properties;

  assert.equal(properties["modBear.tidy.enabled"]?.default, DEFAULTS.tidyEnabled);
  assert.equal(properties["modBear.scan.tidyTtlMinutes"]?.default, DEFAULTS.tidyTtlMinutes);
  assert.ok(properties["modBear.scan.tidyTtlMinutes"]?.minimum);
  assert.equal(properties["modBear.scan.vulnerabilityTtlMinutes"]?.default, DEFAULTS.vulnerabilityTtlMinutes);
  assert.ok(properties["modBear.scan.vulnerabilityTtlMinutes"]?.minimum);
  assert.deepEqual(properties["modBear.diagnostics.importedVulnerabilitySeverity"]?.enum, [
    "error",
    "warning",
    "information",
    "none",
  ]);
  assert.equal(properties["modBear.diagnostics.importedVulnerabilitySeverity"]?.default, "warning");
  assert.equal(properties["modBear.vulnerability.includeTests"]?.default, false);
  assert.deepEqual(properties["modBear.vulnerability.buildTags"]?.default, []);
  assert.equal(properties["modBear.vulnerability.database"]?.default, "");
  assert.equal(properties["modBear.vulnerability.database"]?.scope, "window");
});
