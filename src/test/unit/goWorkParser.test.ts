import assert from "node:assert/strict";
import test from "node:test";
import { parseGoWorkUses } from "../../discovery/goWorkParser";

test("parses single and block use directives", () => {
  const text = `go 1.24\nuse ./one\nuse (\n  ./two\n  ../shared\n)\n`;
  assert.deepEqual(parseGoWorkUses(text), ["./one", "./two", "../shared"]);
});

test("removes comments and unquotes paths", () => {
  const text = `use "./quoted" // local module\nuse (\n  ./plain // comment\n)\n`;
  assert.deepEqual(parseGoWorkUses(text), ["./quoted", "./plain"]);
});
