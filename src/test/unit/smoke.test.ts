import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

async function loadExtensionId(): Promise<string> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {
        workspace: {
          isTrusted: true,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const ext = await import("../../extension.js");
    return ext.EXTENSION_ID;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("exports the stable extension id", async () => {
  const EXTENSION_ID = await loadExtensionId();
  assert.equal(EXTENSION_ID, "diaszano.modbear");
});
