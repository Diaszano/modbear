import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { GoModDocumentCache } from "../../parsers/goModDocumentCache";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

async function loadGoModDocumentCache(): Promise<{ GoModDocumentCache: typeof GoModDocumentCache }> {
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await import("../../parsers/goModDocumentCache.js");
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("GoModDocumentCache caches parser results by document version", async () => {
  const { GoModDocumentCache } = await loadGoModDocumentCache();
  const cache = new GoModDocumentCache();

  let getTextCalls = 0;
  const document: any = {
    uri: {
      toString: () => "file:///mock/go.mod",
    },
    version: 1,
    getText: () => {
      getTextCalls++;
      return "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n";
    },
  };

  const res1 = cache.get(document);
  const res2 = cache.get(document);

  assert.equal(getTextCalls, 1);
  assert.deepEqual(res1, res2);

  document.version = 2;
  const res3 = cache.get(document);
  assert.equal(getTextCalls, 2);
  assert.deepEqual(res1, res3);
});

test("GoModDocumentCache delete removes specific document entry", async () => {
  const { GoModDocumentCache } = await loadGoModDocumentCache();
  const cache = new GoModDocumentCache();

  let getTextCalls = 0;
  const document: any = {
    uri: {
      toString: () => "file:///mock/go.mod",
    },
    version: 1,
    getText: () => {
      getTextCalls++;
      return "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n";
    },
  };

  cache.get(document);
  assert.equal(getTextCalls, 1);

  cache.delete(document.uri);
  cache.get(document);
  assert.equal(getTextCalls, 2);
});

test("GoModDocumentCache clear flushes all document entries", async () => {
  const { GoModDocumentCache } = await loadGoModDocumentCache();
  const cache = new GoModDocumentCache();

  let getTextCalls = 0;
  const document: any = {
    uri: {
      toString: () => "file:///mock/go.mod",
    },
    version: 1,
    getText: () => {
      getTextCalls++;
      return "module example.com/app\n\nrequire github.com/gin-gonic/gin v1.9.1\n";
    },
  };

  cache.get(document);
  assert.equal(getTextCalls, 1);

  cache.clear();
  cache.get(document);
  assert.equal(getTextCalls, 2);
});
