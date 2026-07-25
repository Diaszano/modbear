import assert from "node:assert/strict";
import test from "node:test";
import { classifyUpdate, parseGoVersion } from "../../parsers/goVersionParser";

test("classifies patch, minor, major, prerelease, and pseudo versions", () => {
  assert.equal(classifyUpdate("v1.2.3", "v1.2.4"), "patch");
  assert.equal(classifyUpdate("v1.2.3", "v1.3.0"), "minor");
  assert.equal(classifyUpdate("v0.9.0", "v1.0.0"), "major");
  assert.equal(classifyUpdate("v1.2.3", "v1.3.0-rc.1"), "prerelease");
  assert.equal(classifyUpdate("v0.0.0-20250101120000-abcdefabcdef", "v0.0.0-20260101120000-fedcbafedcba"), "pseudo");
});

test("parseGoVersion extracts semver parts correctly", () => {
  assert.deepEqual(parseGoVersion("v1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    pseudo: false,
  });
  assert.deepEqual(parseGoVersion("v2.10.5-alpha.1+build123"), {
    major: 2,
    minor: 10,
    patch: 5,
    prerelease: "alpha.1",
    pseudo: false,
  });
  assert.equal(parseGoVersion("invalid"), undefined);
});

test("classifyUpdate handles same version or invalid versions as unknown", () => {
  assert.equal(classifyUpdate("v1.2.3", "v1.2.3"), "unknown");
  assert.equal(classifyUpdate("invalid", "v1.2.4"), "unknown");
  assert.equal(classifyUpdate("v1.2.3", "invalid"), "unknown");
});
