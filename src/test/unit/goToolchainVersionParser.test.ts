import assert from "node:assert/strict";
import test from "node:test";
import { compareToolchainVersions, parseToolchainVersion } from "../../parsers/goToolchainVersionParser";

test("parses bare release versions with and without the go prefix", () => {
  assert.deepEqual(parseToolchainVersion("1.24"), { major: 1, minor: 24 });
  assert.deepEqual(parseToolchainVersion("go1.24"), { major: 1, minor: 24 });
});

test("parses patch releases", () => {
  assert.deepEqual(parseToolchainVersion("go1.24.7"), { major: 1, minor: 24, patch: 7 });
  assert.deepEqual(parseToolchainVersion("1.23.0"), { major: 1, minor: 23, patch: 0 });
});

test("parses beta and rc prereleases including patch combinations", () => {
  assert.deepEqual(parseToolchainVersion("1.24beta1"), {
    major: 1,
    minor: 24,
    prerelease: { kind: "beta", number: 1 },
  });
  assert.deepEqual(parseToolchainVersion("go1.25rc2"), {
    major: 1,
    minor: 25,
    prerelease: { kind: "rc", number: 2 },
  });
  assert.deepEqual(parseToolchainVersion("go1.22.0rc1"), {
    major: 1,
    minor: 22,
    patch: 0,
    prerelease: { kind: "rc", number: 1 },
  });
});

test("orders a release candidate below its final release", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("go1.25rc1")!, parseToolchainVersion("1.25.0")!), -1);
});

test("orders patch releases across minors", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("go1.24.0")!, parseToolchainVersion("go1.23.9")!), 1);
});

test("treats a missing patch as zero regardless of prefix", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.24")!, parseToolchainVersion("go1.24.0")!), 0);
  assert.equal(compareToolchainVersions(parseToolchainVersion("go1.25rc1")!, parseToolchainVersion("go1.25rc1")!), 0);
});

test("orders majors and minors", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.24")!, parseToolchainVersion("1.25")!), -1);
  assert.equal(compareToolchainVersions(parseToolchainVersion("go2.0")!, parseToolchainVersion("go1.99")!), 1);
});

test("orders beta below rc and prerelease numbers ascending", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.24beta1")!, parseToolchainVersion("1.24rc1")!), -1);
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.25rc1")!, parseToolchainVersion("1.25rc2")!), -1);
});

test("orders any prerelease below its final release", () => {
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.24")!, parseToolchainVersion("1.24rc9")!), 1);
  assert.equal(compareToolchainVersions(parseToolchainVersion("1.24beta2")!, parseToolchainVersion("1.24")!), -1);
});

test("rejects malformed version strings", () => {
  assert.equal(parseToolchainVersion("go1.x"), undefined);
  assert.equal(parseToolchainVersion(""), undefined);
  assert.equal(parseToolchainVersion("go"), undefined);
  assert.equal(parseToolchainVersion("1"), undefined);
  assert.equal(parseToolchainVersion("v1.24.0"), undefined);
  assert.equal(parseToolchainVersion("1.24-beta1"), undefined);
  assert.equal(parseToolchainVersion("1.24.4.1"), undefined);
  assert.equal(parseToolchainVersion("latest"), undefined);
  assert.equal(parseToolchainVersion(" 1.24"), undefined);
});
