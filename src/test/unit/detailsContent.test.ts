import assert from "node:assert/strict";
import test from "node:test";
import type { DependencyStatus } from "../../domain/analysis";
import type { VulnerabilityAnalysis } from "../../domain/vulnerability";
import {
  buildAdvisoryLink,
  buildDependencyDetailsContent,
  buildTidyDiffContent,
  buildWhyDetailsContent,
  escapeMarkdown,
  sanitizeOsvId,
} from "../../providers/detailsContent";

function buildStatus(overrides: Partial<DependencyStatus> = {}): DependencyStatus {
  return {
    modulePath: "example.com/library",
    installedVersion: "v1.0.0",
    availableVersion: "v1.1.0",
    updateKind: "minor",
    deprecatedMessage: "use example.com/new instead",
    retractionRationales: ["superseded release"],
    errors: [],
    ...overrides,
  };
}

function buildVulnerabilities(overrides: Partial<VulnerabilityAnalysis> = {}): VulnerabilityAnalysis {
  return {
    state: "complete",
    findings: [
      {
        osvId: "GO-2026-0001",
        fixedVersion: "v1.2.3",
        classification: "reachable",
        trace: [{ module: "example.com/library", version: "v1.0.0" }],
      },
    ],
    advisories: {
      "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical parsing issue", details: "Crafted input causes harm." },
    },
    errors: [],
    ...overrides,
  };
}

test("dependency details include sanitized advisory, classification, fix, and lifecycle text", () => {
  const content = buildDependencyDetailsContent(buildStatus(), buildVulnerabilities());
  assert.match(content, /# example\.com\/library/);
  assert.match(content, /GO-2026-0001/);
  assert.match(content, /reachable/);
  assert.match(content, /v1\.2\.3/);
  assert.match(content, /Critical parsing issue/);
  assert.match(content, /Crafted input causes harm\\\./);
  assert.match(content, /use example\\\.com\/new instead/);
  assert.match(content, /superseded release/);
});

test("escapes markdown metacharacters in advisory text", () => {
  const vulnerabilities = buildVulnerabilities({
    advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical **issue** #1" } },
  });
  const content = buildDependencyDetailsContent(buildStatus(), vulnerabilities);
  assert.ok(content.includes("Critical \\*\\*issue\\*\\* \\#1"), content);
});

test("ignores findings that do not trace back to the dependency", () => {
  const vulnerabilities = buildVulnerabilities({
    findings: [{ osvId: "GO-2026-0002", classification: "imported", trace: [{ module: "example.com/other" }] }],
  });
  const content = buildDependencyDetailsContent(buildStatus(), vulnerabilities);
  assert.ok(!content.includes("GO-2026-0002"));
});

test("why details fence the explanation and keep the module path", () => {
  const content = buildWhyDetailsContent("example.com/library", "# example.com/app\nexample.com/library");
  assert.match(content, /# Why is example\.com\/library needed\?/);
  assert.match(content, /example\.com\/app\nexample\.com\/library/);
  assert.match(content, /```/);
});

test("tidy diff details fence the raw diff output", () => {
  const diff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";
  const content = buildTidyDiffContent(diff);
  assert.match(content, /```diff/);
  assert.ok(content.includes(diff.trimEnd()));
});

test("builds a credential-free pkg.go.dev advisory link", () => {
  const link = buildAdvisoryLink("GO-2026-0001");
  assert.equal(link, "https://pkg.go.dev/vuln/GO-2026-0001");
});

test("sanitizes hostile advisory identifiers before building links", () => {
  assert.equal(sanitizeOsvId("GO-2026-0001\n# injected"), "GO-2026-0001injected");
  const link = buildAdvisoryLink("https://evil.example/#x");
  assert.match(link, /^https:\/\/pkg\.go\.dev\/vuln\/[A-Za-z0-9._~-]+$/);
});

test("escapeMarkdown neutralizes markdown structure characters", () => {
  assert.equal(escapeMarkdown("a*b_#"), "a\\*b\\_\\#");
});
