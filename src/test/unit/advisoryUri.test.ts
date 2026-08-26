import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { validateAdvisoryUri } from "../../security/advisoryUri";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface FakeUri {
  readonly scheme: string;
  readonly authority: string;
}

function parseFakeUri(value: string): FakeUri {
  const url = new URL(value);
  const credentials = [decodeURIComponent(url.username), decodeURIComponent(url.password)].filter(Boolean).join(":");
  return {
    scheme: url.protocol.replace(/:$/, ""),
    authority: credentials ? `${credentials}@${url.host}` : url.host,
  };
}

let validate: typeof validateAdvisoryUri | undefined;

async function loadValidateAdvisoryUri(): Promise<typeof validateAdvisoryUri> {
  if (validate) return validate;
  const nodeRequire = createRequire(__filename);
  const moduleLoader = nodeRequire("node:module") as { _load: ModuleLoader };
  const originalLoad = moduleLoader._load;
  moduleLoader._load = function (request, parent, isMain) {
    if (request === "vscode") {
      return { Uri: { parse: parseFakeUri } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    validate = (await import("../../security/advisoryUri.js")).validateAdvisoryUri;
    return validate;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

test("accepts credential-free https advisory links", async () => {
  const validateAdvisoryUri = await loadValidateAdvisoryUri();
  const uri = validateAdvisoryUri("https://pkg.go.dev/example.com/library");
  assert.equal(uri.scheme, "https");
});

test("accepts credential-free http advisory links", async () => {
  const validateAdvisoryUri = await loadValidateAdvisoryUri();
  assert.equal(validateAdvisoryUri("http://example.test/advisory").scheme, "http");
});

test("rejects advisory links that embed credentials", async () => {
  const validateAdvisoryUri = await loadValidateAdvisoryUri();
  assert.throws(() => validateAdvisoryUri("https://user:secret@example.test/advisory"));
});

test("rejects non-http schemes", async () => {
  const validateAdvisoryUri = await loadValidateAdvisoryUri();
  assert.throws(() => validateAdvisoryUri("command:workbench.action.reloadWindow"));
  assert.throws(() => validateAdvisoryUri("ftp://example.test/advisory"));
  assert.throws(() => validateAdvisoryUri("file:///etc/passwd"));
  assert.throws(() => validateAdvisoryUri("javascript:alert(1)"));
});
