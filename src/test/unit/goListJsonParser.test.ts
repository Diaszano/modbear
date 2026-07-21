import assert from "node:assert/strict";
import test from "node:test";
import { parseGoListJson } from "../../parsers/goListJsonParser";

test("parses concatenated module JSON objects", () => {
  const input = `{"Path":"a","Version":"v1.0.0","Update":{"Path":"a","Version":"v1.1.0"}}\n{"Path":"b","Version":"v2.0.0","Deprecated":"use c","Retracted":["bad release"]}`;
  const modules = parseGoListJson(input);
  assert.equal(modules.length, 2);
  assert.equal(modules[0]?.Update?.Version, "v1.1.0");
  assert.deepEqual(modules[1]?.Retracted, ["bad release"]);
});

test("parses formatted json objects with whitespace and strings containing braces", () => {
  const input = `
{
  "Path": "example.com/mod{foo}",
  "Version": "v1.0.0",
  "Main": true,
  "Dir": "/path/to/mod"
}
{
  "Path": "example.com/other",
  "Version": "v2.0.0",
  "Error": { "Err": "failed to load" }
}
`;
  const modules = parseGoListJson(input);
  assert.equal(modules.length, 2);
  assert.equal(modules[0]?.Path, "example.com/mod{foo}");
  assert.equal(modules[0]?.Main, true);
  assert.equal(modules[1]?.Error?.Err, "failed to load");
});

test("throws error on incomplete json stream", () => {
  assert.throws(() => parseGoListJson('{"Path":"a"'), /Incomplete go list JSON stream/);
  assert.throws(() => parseGoListJson('{"Path":"a", "Version": "v1.0.0"'), /Incomplete go list JSON stream/);
});

test("returns empty array for empty or whitespace input", () => {
  assert.deepEqual(parseGoListJson(""), []);
  assert.deepEqual(parseGoListJson("   \n\t  "), []);
});
