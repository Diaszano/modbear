import assert from "node:assert/strict";
import test from "node:test";
import { createCacheKey } from "../../cache/cacheKey";

test("cache key changes with go.mod content and settings", () => {
  const first = createCacheKey({ moduleRoot: "/x", goMod: "a", goSum: "", goWork: "", tool: "go", toolVersion: "go1.25", settings: { indirect: true } });
  const second = createCacheKey({ moduleRoot: "/x", goMod: "b", goSum: "", goWork: "", tool: "go", toolVersion: "go1.25", settings: { indirect: true } });
  assert.notEqual(first, second);
});

test("cache key is deterministic regardless of key order", () => {
  const key1 = createCacheKey({ a: "1", b: "2", nested: { y: "b", x: "a" } });
  const key2 = createCacheKey({ b: "2", a: "1", nested: { x: "a", y: "b" } });
  assert.equal(key1, key2);
});

test("identical inputs generate identical cache keys", () => {
  const input = { moduleRoot: "/x", goMod: "a", settings: { indirect: true } };
  assert.equal(createCacheKey(input), createCacheKey(input));
});
