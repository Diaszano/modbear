import assert from "node:assert/strict";
import test from "node:test";
import { GoListJsonStreamParser } from "../../parsers/goListJsonStreamParser";

test("splits a JSON object inside an escaped string and expects one complete module array", () => {
  const parser = new GoListJsonStreamParser();
  // The JSON is: {"Path":"foo\"bar","Version":"v1.0.0"}
  // We split inside the escape sequence.
  const part1 = '{"Path": "foo\\';
  const part2 = '"bar", "Version": "v1.0.0"}';

  parser.push(Buffer.from(part1, "utf8"));
  parser.push(Buffer.from(part2, "utf8"));

  const modules = parser.finish();
  assert.equal(modules.length, 1);
  assert.equal(modules[0]?.Path, 'foo"bar');
  assert.equal(modules[0]?.Version, 'v1.0.0');
});

test("parses multiple JSON objects split across arbitrary chunks", () => {
  const parser = new GoListJsonStreamParser();
  const chunk1 = '  {"Path": "a"}\n  {';
  const chunk2 = '"Path": "b"}\n';

  parser.push(Buffer.from(chunk1, "utf8"));
  parser.push(Buffer.from(chunk2, "utf8"));

  const modules = parser.finish();
  assert.equal(modules.length, 2);
  assert.equal(modules[0]?.Path, "a");
  assert.equal(modules[1]?.Path, "b");
});

test("throws error on incomplete JSON stream", () => {
  const parser = new GoListJsonStreamParser();
  parser.push(Buffer.from('{"Path": "a"', "utf8"));
  assert.throws(() => {
    parser.finish();
  }, /Incomplete go list JSON stream/);
});
