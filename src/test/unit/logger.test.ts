import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

test("Logger redacts raw caught errors before writing to the Output Channel", async () => {
  const output: { errors: string[] } = { errors: [] };
  const vscode = {
    window: {
      createOutputChannel: () => ({
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message: string) => output.errors.push(message),
        show: () => undefined,
        dispose: () => undefined
      })
    }
  };
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    return request === "vscode" ? vscode : originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { Logger } = await import("../../logging/logger.js");
    new Logger().error("Scan failed: Error: https://token:super-secret@example.com/private/module");
  } finally {
    moduleLoader._load = originalLoad;
  }

  assert.deepEqual(output.errors, [
    "Scan failed: Error: https://***@example.com/private/module"
  ]);
});
