import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { AnalysisCache } from "../../cache/analysisCache";
import { buildSnapshotDiagnostics } from "../../extension";
import { ModuleScanner } from "../../orchestration/moduleScanner";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

suite("full scan composition", () => {
  test("merges update, lifecycle, vulnerability, tidy, and toolchain diagnostics into one snapshot result", () => {
    const parsed = parseGoModPositions([
      "module example.com/app",
      "",
      "go 1.25.0",
      "toolchain go1.26.0",
      "",
      "require example.com/library v1.0.0"
    ].join("\n"));
    const diagnostics = buildSnapshotDiagnostics(parsed, {
      dependencies: [{
        modulePath: "example.com/library",
        installedVersion: "v1.0.0",
        availableVersion: "v1.1.0",
        updateKind: "minor",
        deprecatedMessage: "use example.com/maintained",
        retractionRationales: ["bad release"],
        errors: []
      }],
      replacements: [],
      vulnerabilities: {
        state: "complete",
        findings: [{
          osvId: "GO-2026-0001",
          classification: "reachable",
          fixedVersion: "v1.2.0",
          trace: [{ module: "example.com/library", version: "v1.0.0" }]
        }],
        advisories: { "GO-2026-0001": { id: "GO-2026-0001", summary: "Critical finding" } },
        errors: []
      },
      tidy: { state: "complete", consistent: false, diff: "diff --git a/go.mod b/go.mod", errors: [] },
      toolchain: { state: "complete", installed: "go1.24.0", required: "1.25.0", suggested: "go1.26.0", errors: [] }
    }, "warning", "warning");

    assert.deepEqual(diagnostics.map((item) => item.code).sort(), [
      "GO-2026-0001",
      "deprecated",
      "go-version",
      "retracted",
      "tidy-diff",
      "toolchain-version",
      "update-available"
    ]);
  });

  test("passes the imported-vulnerability diagnostic setting into the snapshot mapper", () => {
    const parsed = parseGoModPositions("module example.com/app\n\nrequire example.com/library v1.0.0\n");
    const snapshot = {
      dependencies: [],
      replacements: [],
      vulnerabilities: {
        state: "complete" as const,
        findings: [
          {
            osvId: "GO-2026-imported",
            classification: "imported" as const,
            trace: [{ module: "example.com/library", version: "v1.0.0" }]
          }
        ],
        advisories: {},
        errors: []
      },
      tidy: { state: "idle" as const, consistent: true, errors: [] },
      toolchain: { state: "idle" as const, errors: [] }
    };

    const cases: ReadonlyArray<{
      setting: "none" | "information" | "warning";
      expectedSeverity?: vscode.DiagnosticSeverity;
    }> = [
      { setting: "none" },
      { setting: "information", expectedSeverity: vscode.DiagnosticSeverity.Information },
      { setting: "warning", expectedSeverity: vscode.DiagnosticSeverity.Warning }
    ];

    for (const { setting, expectedSeverity } of cases) {
      const diagnostics = buildSnapshotDiagnostics(parsed, snapshot, "none", setting);
      assert.equal(diagnostics.length, expectedSeverity === undefined ? 0 : 1, setting);
      assert.equal(diagnostics[0]?.severity, expectedSeverity, setting);
    }
  });

  test("runs tidy only for a manual scan while retaining update and toolchain results", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modbear-full-scan-"));
    try {
      const goModPath = path.join(root, "go.mod");
      const tidyCountPath = path.join(root, "tidy-count");
      const goPath = path.join(root, "go");
      await writeFile(goModPath, "module example.com/app\n\ngo 1.24.0\n\nrequire example.com/library v1.0.0\n");
      await writeFile(tidyCountPath, "0");
      await writeFile(goPath, `#!/usr/bin/env node
const fs = require("node:fs");
const [command, ...args] = process.argv.slice(2);
if (command === "version") process.stdout.write("go version go1.25.0 linux/amd64\\n");
if (command === "env") process.stdout.write("go1.25.0\\n");
if (command === "list") process.stdout.write(JSON.stringify({ Path: "example.com/library", Version: "v1.0.0" }));
if (command === "mod" && args[0] === "tidy") fs.writeFileSync(${JSON.stringify(tidyCountPath)}, "1");
`);
      await chmod(goPath, 0o755);
      const scanner = new ModuleScanner(
        new AnalysisCache(path.join(root, "cache")),
        goPath,
        5_000,
        60_000,
        undefined,
        undefined,
        { tidyEnabled: true, tidyTtlMs: 60_000, vulnerabilityTtlMs: 60_000 }
      );
      const module = { id: "app", moduleRoot: root, goModPath };

      const background = await scanner.scan(module, new AbortController().signal, "background");
      assert.equal(await readFile(tidyCountPath, "utf8"), "0");
      assert.equal(background.dependencies.length, 1);
      assert.equal(background.toolchain.state, "complete");

      const manual = await scanner.scan(module, new AbortController().signal, "manual");
      assert.equal(await readFile(tidyCountPath, "utf8"), "1");
      assert.equal(manual.tidy.state, "complete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
