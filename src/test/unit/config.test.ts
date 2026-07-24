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
  let configuredLevel: unknown = "invalid";
  const readConfig = await loadReadConfig((key, fallback) => key === "output.logLevel" ? configuredLevel : fallback);

  for (const invalidLevel of ["invalid", 1, false, null]) {
    configuredLevel = invalidLevel;
    assert.equal(readConfig().logLevel, "info");
  }

  configuredLevel = "debug";
  assert.equal(readConfig().logLevel, "debug");
});
