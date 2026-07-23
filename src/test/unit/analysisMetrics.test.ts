import assert from "node:assert/strict";
import test from "node:test";
import { getSnapshotMetrics } from "../../domain/analysis";
import type { ModuleAnalysisSnapshot } from "../../domain/analysis";

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
    errors: []
  };

  const metrics = getSnapshotMetrics(snapshot);
  assert.equal(metrics.updates, 2);
  assert.equal(metrics.warnings, 2);
});
