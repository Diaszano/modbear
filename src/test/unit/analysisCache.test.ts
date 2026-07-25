import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AnalysisCache } from "../../cache/analysisCache";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";

const notRunVulnerabilities = { state: "not-run" as const, findings: [], advisories: {}, errors: [] };
const notRunTidy = { state: "idle" as const, consistent: false, errors: [] };

const mockSnapshot: ModuleAnalysisSnapshot = {
  moduleId: "mod-1",
  contentHash: "hash-123",
  createdAt: "2026-07-21T00:00:00Z",
  stale: false,
  updateState: "complete",
  dependencies: [],
  replacements: [],
  vulnerabilities: notRunVulnerabilities,
  tidy: notRunTidy,
  errors: []
};

const makeKey = (i: number): string => String(i).padStart(64, "0");

test("AnalysisCache stores, retrieves, and deletes schema 3 snapshots", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-cache-"));
  try {
    const cache = new AnalysisCache(tmpDir);

    assert.equal(await cache.get("key-1"), undefined);

    await cache.set("key-1", mockSnapshot);
    const retrieved = await cache.get("key-1");
    assert.deepEqual(retrieved, mockSnapshot);

    await cache.delete("key-1");
    assert.equal(await cache.get("key-1"), undefined);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("AnalysisCache rejects schema 2 snapshots from before tidy analysis", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-cache-legacy-"));
  try {
    const cache = new AnalysisCache(tmpDir);
    const key = makeKey(998);
    const filePath = path.join(tmpDir, `${key}.json`);
    await writeFile(filePath, JSON.stringify({ schema: 2, snapshot: mockSnapshot, lastAccessedAt: Date.now() }), "utf8");

    assert.equal(await cache.get(key), undefined);
    await assert.rejects(access(filePath));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("AnalysisCache limits cache growth to 100 snapshots ordered by lastAccessedAt ascending", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-cache-limit-"));
  const originalNow = Date.now;
  try {
    const cache = new AnalysisCache(tmpDir);

    let fakeNow = 1000;
    Date.now = () => fakeNow++;

    // Write 101 snapshots
    for (let i = 0; i < 101; i++) {
      const key = makeKey(i);
      await cache.set(key, { ...mockSnapshot, moduleId: `mod-${i}` });
    }

    // Verify exactly 100 files remain on disk matching the regex /^[a-f0-9]{64}\.json$/
    const files = await readdir(tmpDir);
    const jsonFiles = files.filter(f => /^[a-f0-9]{64}\.json$/.test(f));
    assert.equal(jsonFiles.length, 100);

    // The first one (key for i=0) had the lowest lastAccessedAt, so it should have been pruned.
    const firstKeyFile = `${makeKey(0)}.json`;
    assert.equal(jsonFiles.includes(firstKeyFile), false);

    // The remaining keys should be 1 to 100.
    for (let i = 1; i <= 100; i++) {
      assert.equal(jsonFiles.includes(`${makeKey(i)}.json`), true);
    }
  } finally {
    Date.now = originalNow;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("AnalysisCache ignores and deletes corrupt/truncated cache files", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "modbear-test-cache-corrupt-"));
  try {
    const cache = new AnalysisCache(tmpDir);
    const key = makeKey(999);
    const filePath = path.join(tmpDir, `${key}.json`);

    // Write invalid/corrupt JSON content
    await writeFile(filePath, '{ "schema": 2, "snapshot": ', "utf8");

    // Retrieve from cache: should return undefined and delete the file
    const retrieved = await cache.get(key);
    assert.equal(retrieved, undefined);

    // Verify the file was deleted
    let fileExists = true;
    try {
      await access(filePath);
    } catch {
      fileExists = false;
    }
    assert.equal(fileExists, false);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
