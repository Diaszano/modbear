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
    end: { line: 7, character: 32 }
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
