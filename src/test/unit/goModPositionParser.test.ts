import assert from "node:assert/strict";
import test from "node:test";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

const MOD = `module example.com/app\r\n\r\ngo 1.24.0\r\ntoolchain go1.25.1\r\n\r\nrequire github.com/google/uuid v1.5.0\r\nrequire (\r\n\tgithub.com/gin-gonic/gin v1.9.1\r\n\tgolang.org/x/net v0.20.0 // indirect\r\n)\r\nreplace example.com/local => ../local\r\n`;

test("parses directives and exact requirement ranges", () => {
  const parsed = parseGoModPositions(MOD);
  assert.equal(parsed.module?.path, "example.com/app");
  assert.equal(parsed.go?.version, "1.24.0");
  assert.equal(parsed.toolchain?.version, "go1.25.1");
  assert.equal(parsed.requirements.length, 3);
  assert.equal(parsed.requirements[1]?.modulePath, "github.com/gin-gonic/gin");
  assert.deepEqual(parsed.requirements[1]?.versionRange, {
    start: { line: 7, character: 26 },
    end: { line: 7, character: 32 },
  });
  assert.equal(parsed.requirements[2]?.indirect, true);
});

test("parses a local replacement", () => {
  const parsed = parseGoModPositions(MOD);
  assert.equal(parsed.replacements[0]?.newPath, "../local");
  assert.equal(parsed.replacements[0]?.local, true);
});

test("returns partial results for incomplete input", () => {
  const parsed = parseGoModPositions("require (\n  example.com/a v1.2.3\n  broken\n");
  assert.equal(parsed.requirements.length, 1);
});

test("correctly calculates range offsets when version string is substring of module path", () => {
  const mod = "require example.com/v1.0.0 v1.0.0\n";
  const parsed = parseGoModPositions(mod);
  assert.equal(parsed.requirements.length, 1);
  assert.equal(parsed.requirements[0]?.modulePath, "example.com/v1.0.0");
  assert.equal(parsed.requirements[0]?.version, "v1.0.0");
  assert.deepEqual(parsed.requirements[0]?.moduleRange, {
    start: { line: 0, character: 8 },
    end: { line: 0, character: 26 },
  });
  assert.deepEqual(parsed.requirements[0]?.versionRange, {
    start: { line: 0, character: 27 },
    end: { line: 0, character: 33 },
  });
});

test("correctly calculates target path range when oldPath and newPath share substrings", () => {
  const mod = "replace example.com/foo => example.com/foo\n";
  const parsed = parseGoModPositions(mod);
  assert.equal(parsed.replacements.length, 1);
  assert.deepEqual(parsed.replacements[0]?.range, {
    start: { line: 0, character: 27 },
    end: { line: 0, character: 42 },
  });
});

test("parses multiline replace block", () => {
  const mod = `replace (\n\texample.com/a => ../a\n\texample.com/b v1.0.0 => example.com/c v2.0.0\n)\n`;
  const parsed = parseGoModPositions(mod);
  assert.equal(parsed.replacements.length, 2);
  assert.equal(parsed.replacements[0]?.oldPath, "example.com/a");
  assert.equal(parsed.replacements[0]?.newPath, "../a");
  assert.equal(parsed.replacements[0]?.local, true);
  assert.equal(parsed.replacements[1]?.oldPath, "example.com/b");
  assert.equal(parsed.replacements[1]?.oldVersion, "v1.0.0");
  assert.equal(parsed.replacements[1]?.newPath, "example.com/c");
  assert.equal(parsed.replacements[1]?.newVersion, "v2.0.0");
  assert.equal(parsed.replacements[1]?.local, false);
});
