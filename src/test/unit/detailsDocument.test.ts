import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { DetailsDocumentProvider } from "../../providers/detailsDocumentProvider";

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;

interface FakeUri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
}

interface DetailsProviderLike {
  set(kind: string, id: string, content: string): FakeUri;
  provideTextDocumentContent(uri: FakeUri): string;
  dispose(): void;
}

function parseFakeUri(value: string): FakeUri {
  const url = new URL(value);
  const credentials = [decodeURIComponent(url.username), decodeURIComponent(url.password)].filter(Boolean).join(":");
  return {
    scheme: url.protocol.replace(/:$/, ""),
    authority: credentials ? `${credentials}@${url.host}` : url.host,
    path: url.pathname,
  };
}

let DetailsDocumentProviderCtor: typeof DetailsDocumentProvider | undefined;

async function loadDetailsDocumentProvider(): Promise<typeof DetailsDocumentProvider> {
  if (DetailsDocumentProviderCtor) return DetailsDocumentProviderCtor;
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
    DetailsDocumentProviderCtor = (await import("../../providers/detailsDocumentProvider.js")).DetailsDocumentProvider;
    return DetailsDocumentProviderCtor;
  } finally {
    moduleLoader._load = originalLoad;
  }
}

async function createDetailsDocumentProvider(): Promise<DetailsProviderLike> {
  return new (await loadDetailsDocumentProvider())();
}

test("serves stored detail documents under the modbear scheme", async () => {
  const provider = await createDetailsDocumentProvider();
  const uri = provider.set("dependency", "example.com/library", "# example.com/library\n\nInstalled: `v1.0.0`");
  assert.equal(uri.scheme, "modbear");
  assert.equal(uri.path, "/dependency/example.com%2Flibrary.md");

  const rendered = provider.provideTextDocumentContent(uri);
  assert.match(rendered, /read-only/i);
  assert.match(rendered, /immutable/i);
  assert.match(rendered, /Suggested commands are not executed/);
  assert.match(rendered, /# example\.com\/library/);
  assert.ok(rendered.indexOf("Suggested commands are not executed") < rendered.indexOf("# example.com/library"));
});

test("returns the unavailable placeholder for unknown modbear URIs", async () => {
  const provider = await createDetailsDocumentProvider();
  assert.equal(
    provider.provideTextDocumentContent(parseFakeUri("modbear:/missing/item.md")),
    "# ModBear\n\nDetails are no longer available.",
  );
});

test("clears pending documents on disposal", async () => {
  const provider = await createDetailsDocumentProvider();
  const uri = provider.set("advisory", "GO-2026-0001", "**GO-2026-0001** Unsafe request parsing");
  assert.doesNotMatch(provider.provideTextDocumentContent(uri), /no longer available/);
  provider.dispose();
  assert.equal(provider.provideTextDocumentContent(uri), "# ModBear\n\nDetails are no longer available.");
});
