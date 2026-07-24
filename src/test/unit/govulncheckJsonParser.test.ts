import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parseGovulncheckStream } from "../../parsers/govulncheckJsonParser";

const fixture = (name: string): string => readFileSync(resolve("src/test/fixtures/govulncheck", name), "utf8");

test("parses protocol v1 config, advisories, findings, and progress", () => {
  const stream = parseGovulncheckStream(fixture("symbol-stream.jsonl"));

  assert.deepEqual(stream.config, {
    protocolVersion: "v1.0.0",
    scannerName: "govulncheck",
    scannerVersion: "v1.1.4",
    database: "https://vuln.go.dev",
    databaseLastModified: "2026-07-24T12:00:00Z",
    goVersion: "go1.24.0",
    scanLevel: "symbol",
    scanMode: "source"
  });
  assert.deepEqual(stream.progress, [{ timestamp: "2026-07-24T12:01:00Z", message: "Scanning packages..." }]);
  assert.deepEqual(stream.advisories.get("GO-2026-0001"), {
    id: "GO-2026-0001",
    summary: "Unsafe request parsing",
    details: "A vulnerable request parser can panic.",
    aliases: ["CVE-2026-0001"],
    published: "2026-07-01T00:00:00Z",
    modified: "2026-07-02T00:00:00Z"
  });
  assert.deepEqual(stream.findings, [{
    osvId: "GO-2026-0001",
    fixedVersion: "v1.2.3",
    trace: [
      {
        module: "example.com/vulnerable",
        version: "v1.2.2",
        package: "example.com/vulnerable/http",
        function: "Parse",
        position: { filename: "/workspace/main.go", line: 42, column: 7 }
      },
      {
        module: "example.com/app",
        version: "v0.0.0",
        package: "example.com/app",
        function: "main"
      }
    ]
  }]);
});

test("exposes advisories through an immutable runtime map", () => {
  const stream = parseGovulncheckStream(fixture("symbol-stream.jsonl"));
  const advisories = stream.advisories as unknown as Map<string, unknown>;

  assert.throws(() => advisories.set("GO-2026-9999", { id: "GO-2026-9999" }), TypeError);
  assert.throws(() => advisories.delete("GO-2026-0001"), TypeError);
  assert.equal(stream.advisories.size, 1);
  assert.ok(stream.advisories.has("GO-2026-0001"));
});

test("retains known protocol fields and ignores future fields", () => {
  const stream = parseGovulncheckStream(fixture("unknown-fields.jsonl"));

  assert.deepEqual(stream.config, { protocolVersion: "v1.2.0", scannerName: "govulncheck" });
  assert.deepEqual(stream.progress, [{ message: "Scanning" }]);
  assert.deepEqual(stream.advisories.get("GO-2026-0002"), {
    id: "GO-2026-0002",
    summary: "Known advisory",
    details: "Known details"
  });
  assert.deepEqual(stream.findings, [{
    osvId: "GO-2026-0002",
    fixedVersion: "v1.0.1",
    trace: [{
      module: "example.com/library",
      version: "v1.0.0",
      package: "example.com/library",
      function: "Run",
      position: { filename: "/workspace/library.go", line: 3, column: 1 }
    }]
  }]);
});

test("rejects unsupported protocol major versions", () => {
  assert.throws(
    () => parseGovulncheckStream('{"config":{"protocol_version":"v2.0.0"}}\n'),
    /Unsupported govulncheck protocol/
  );
});

test("rejects malformed JSON with its line number", () => {
  assert.throws(
    () => parseGovulncheckStream('{"config":{"protocol_version":"v1.0.0"}}\n{not json}\n'),
    /line 2/i
  );
});

test("requires exactly one initial protocol config", () => {
  assert.throws(() => parseGovulncheckStream(""), /exactly one config/i);
  assert.throws(
    () => parseGovulncheckStream('{"progress":{"message":"before config"}}\n{"config":{"protocol_version":"v1.0.0"}}\n'),
    /first message/i
  );
  assert.throws(
    () => parseGovulncheckStream('{"config":{"protocol_version":"v1.0.0"}}\n{"config":{"protocol_version":"v1.0.0"}}\n'),
    /exactly one config/i
  );
});
