import assert from "node:assert/strict";
import test from "node:test";
import { classifyAnalysisError, getSnapshotMetrics } from "../../domain/analysis";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";
import { ProcessExecutionError } from "../../execution/processRunner";

const notRunVulnerabilities = { state: "not-run" as const, findings: [], advisories: {}, errors: [] };

test("getSnapshotMetrics counts updates and warnings accurately", () => {
  const snapshot: ModuleAnalysisSnapshot = {
    moduleId: "mod-1",
    contentHash: "hash",
    createdAt: new Date().toISOString(),
    stale: false,
    updateState: "complete",
    dependencies: [
      {
        modulePath: "example.com/dep1",
        installedVersion: "v1.0.0",
        availableVersion: "v1.1.0",
        retractionRationales: [],
        errors: []
      },
      {
        modulePath: "example.com/dep2",
        installedVersion: "v1.0.0",
        availableVersion: "v1.2.0",
        deprecatedMessage: "deprecated",
        retractionRationales: ["retracted"],
        errors: []
      },
      {
        modulePath: "example.com/dep3",
        installedVersion: "v1.0.0",
        retractionRationales: [],
        errors: [{ code: "unknown", message: "err" }]
      }
    ],
    replacements: [],
    vulnerabilities: notRunVulnerabilities,
    errors: []
  };

  const metrics = getSnapshotMetrics(snapshot);
  assert.equal(metrics.updates, 2);
  assert.equal(metrics.warnings, 2);
});

test("classifyAnalysisError maps process failures and recognizable network errors", () => {
  assert.equal(classifyAnalysisError(new ProcessExecutionError("spawn", "spawn")), "tool-not-found");
  assert.equal(classifyAnalysisError(new ProcessExecutionError("timeout", "timeout")), "timeout");
  assert.equal(classifyAnalysisError(new ProcessExecutionError("cancelled", "cancelled")), "cancelled");
  assert.equal(classifyAnalysisError(new ProcessExecutionError("too much output", "output-limit")), "output-limit");
  assert.equal(classifyAnalysisError(new ProcessExecutionError("non-zero", "exit-nonzero")), "unknown");
  assert.equal(classifyAnalysisError(new Error("network unavailable")), "network");
});
