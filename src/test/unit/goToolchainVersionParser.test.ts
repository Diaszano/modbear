import assert from "node:assert/strict";
import test from "node:test";
import {
  compareToolchainVersions,
  parseToolchainVersion
} from "../../parsers/goToolchainVersionParser";

test("normalizes Go prefixes and orders prerelease versions before releases", () => {
  const candidate = parseToolchainVersion("go1.25rc1");
  const release = parseToolchainVersion("1.25.0");

  assert.ok(candidate);
  assert.ok(release);
  assert.equal(compareToolchainVersions(candidate, release), -1);
  assert.equal(compareToolchainVersions(parseToolchainVersion("go1.24.0")!, parseToolchainVersion("go1.23.9")!), 1);
});

test("rejects malformed Go toolchain versions", () => {
  assert.equal(parseToolchainVersion("go1.x"), undefined);
});
