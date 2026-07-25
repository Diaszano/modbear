# Module Health and Security Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Complete read-only tidy, toolchain, dependency-explanation, and integrated module-health analysis without weakening existing vulnerability, privacy, or workspace-trust guarantees.

**Architecture:** Add immutable tidy and toolchain phase results to each module snapshot. Keep parsing, process execution, analysis, diagnostics, document presentation, and scan orchestration separate; compose phase outcomes in ModuleScanner and render them only in extension providers.

**Tech Stack:** TypeScript 5, Node.js test runner, VS Code Extension API, shell-free Go CLI processes, existing AnalysisCache and ScanCoordinator.

## Global Constraints

- Never execute a subprocess in an untrusted workspace.
- Every Go command is shell-free and uses buildGoEnvironment() with GOFLAGS=-mod=readonly.
- The only new process arguments are go mod tidy -diff, go env GOVERSION GOWORK, and explicitly requested go mod why -m <module-path>.
- Tidy output is diagnostic-only; no workspace file, Go environment, or module graph is modified.
- Failed health phases must retain usable prior data as stale and must not hide updates or vulnerability results.
- Validate command inputs and advisory URLs; allow only credential-free http: and https: links.
- Diagnostic mappers never start subprocesses or mutate a VS Code collection.
- Preserve existing vulnerability behavior, redaction, output limits, cache bounds, and lifecycle events.

---

## File Structure

| Path                                         | Responsibility                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| src/domain/analysis.ts                       | Immutable tidy/toolchain snapshot contracts and empty-result factories.                   |
| src/parsers/tidyDiffParser.ts                | Distinguish a unified tidy diff from a command failure.                                   |
| src/analyzers/tidyAnalyzer.ts                | Run the exact read-only tidy command and create TidyAnalysis.                             |
| src/diagnostics/tidyDiagnosticMapper.ts      | Map an inconsistent tidy result to the module directive.                                  |
| src/parsers/goToolchainVersionParser.ts      | Normalize and compare Go release, beta, and RC versions.                                  |
| src/analyzers/toolchainAnalyzer.ts           | Obtain GOVERSION and compare it with parsed directives.                                   |
| src/diagnostics/toolchainDiagnosticMapper.ts | Map toolchain compatibility states to directive ranges.                                   |
| src/analyzers/whyAnalyzer.ts                 | Run validated, explicit dependency explanations.                                          |
| src/providers/detailsDocumentProvider.ts     | Serve transient read-only modbear: detail documents.                                      |
| src/orchestration/moduleScanner.ts           | Compose cache identity and update, vulnerability, tidy, and toolchain phases.             |
| src/extension.ts                             | Pass scan trigger context, merge diagnostics, register commands and the virtual provider. |
| src/providers/inlayLabel.ts                  | Prioritize reachable vulnerability labels over lifecycle/update labels.                   |

### Task 1: Add read-only tidy analysis and diagnostic mapping

**Files:**

- Create: src/parsers/tidyDiffParser.ts
- Create: src/analyzers/tidyAnalyzer.ts
- Create: src/diagnostics/tidyDiagnosticMapper.ts
- Modify: src/domain/analysis.ts
- Test: src/test/unit/tidyDiffParser.test.ts
- Test: src/test/integration/tidyAnalyzer.test.ts
- Test: src/test/suite/tidyDiagnosticMapper.test.ts

**Interfaces:**

- Produces classifyTidyResult(exitCode, stdout, stderr): TidyCommandResult and analyzeTidy(options): Promise<TidyAnalysis>.
- Extends ModuleAnalysisSnapshot with tidy: TidyAnalysis.
- Produces mapTidyDiagnostic(parsed, tidy): vscode.Diagnostic | undefined.

- [ ] **Step 1: Write the failing parser tests**

```ts
test("classifies only a unified diff as inconsistent", () => {
  const diff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";
  assert.deepEqual(classifyTidyResult(1, diff, ""), { kind: "diff", diff });
});

test("does not misclassify package-loading errors as diffs", () => {
  assert.deepEqual(classifyTidyResult(1, "", "go: missing: no matching versions"), {
    kind: "error",
    message: "go: missing: no matching versions",
  });
});
```

- [ ] **Step 2: Run the parser test to verify it fails**

Run: npm run test:unit -- --test-name-pattern="tidy"

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Add contracts and the minimal parser**

```ts
export interface TidyAnalysis {
  readonly state: AnalyzerState;
  readonly consistent: boolean;
  readonly diff?: string;
  readonly errors: readonly AnalysisError[];
  readonly scannedAt?: string;
}

export type TidyCommandResult =
  | { readonly kind: "clean" }
  | { readonly kind: "diff"; readonly diff: string }
  | { readonly kind: "error"; readonly message: string };

export function classifyTidyResult(exitCode: number | null, stdout: string, stderr: string): TidyCommandResult {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("diff ") && trimmed.includes("\n--- ") && trimmed.includes("\n+++ "))
    return { kind: "diff", diff: stdout };
  if (exitCode === 0 && !trimmed && !stderr.trim()) return { kind: "clean" };
  return { kind: "error", message: stderr.trim() || trimmed || "go mod tidy -diff exited " + exitCode };
}
```

- [ ] **Step 4: Write the failing analyzer, mutation, and diagnostic tests**

```ts
assert.deepEqual(recorded.args, ["mod", "tidy", "-diff"]);
assert.equal(await sha256(goModPath), beforeGoMod);
assert.equal(await sha256(goSumPath), beforeGoSum);
assert.equal(mapTidyDiagnostic(parsed, inconsistent)?.code, "tidy-diff");
```

- [ ] **Step 5: Implement the analyzer and mapper**

```ts
const result = await runProcess({
  executable: options.goExecutable,
  args: ["mod", "tidy", "-diff"],
  cwd: options.module.moduleRoot,
  env: buildGoEnvironment(),
  timeoutMs: options.timeoutMs,
  stdoutLimitBytes: 20 * 1024 * 1024,
  stderrLimitBytes: 5 * 1024 * 1024,
  signal: options.signal,
});
```

Map only a complete, inconsistent result to the parsed module range with source modbear, severity Warning, and code tidy-diff.

- [ ] **Step 6: Run focused verification**

Run: npm run test:unit && npm run test:integration && npm run test:extension

Expected: PASS; fixture hashes are identical before and after the analyzer runs.

- [ ] **Step 7: Commit the independently testable tidy phase**

```bash
git add src/domain/analysis.ts src/parsers/tidyDiffParser.ts src/analyzers/tidyAnalyzer.ts src/diagnostics/tidyDiagnosticMapper.ts src/test
git commit -m "feat: diagnose read-only tidy differences"
```

### Task 2: Add toolchain compatibility analysis and diagnostics

**Files:**

- Create: src/parsers/goToolchainVersionParser.ts
- Create: src/analyzers/toolchainAnalyzer.ts
- Create: src/diagnostics/toolchainDiagnosticMapper.ts
- Modify: src/domain/analysis.ts
- Test: src/test/unit/goToolchainVersionParser.test.ts
- Test: src/test/unit/toolchainAnalyzer.test.ts
- Test: src/test/suite/toolchainDiagnosticMapper.test.ts

**Interfaces:**

- Produces parseToolchainVersion(value) and compareToolchainVersions(left, right).
- Produces analyzeToolchain(options): Promise<ToolchainAnalysis>.
- Extends snapshots with toolchain: ToolchainAnalysis and maps its diagnostics through mapToolchainDiagnostics(parsed, analysis).

- [ ] **Step 1: Write failing version and analyzer tests**

```ts
assert.equal(compareToolchainVersions(parseToolchainVersion("go1.25rc1")!, parseToolchainVersion("1.25.0")!), -1);
assert.equal(compareToolchainVersions(parseToolchainVersion("go1.24.0")!, parseToolchainVersion("go1.23.9")!), 1);
assert.equal(parseToolchainVersion("go1.x"), undefined);
assert.deepEqual(recorded.args, ["env", "GOVERSION", "GOWORK"]);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: npm run test:unit -- --test-name-pattern="toolchain"

Expected: FAIL because the parser and analyzer do not exist.

- [ ] **Step 3: Add contracts, parser, and analyzer**

```ts
export interface ToolchainAnalysis {
  readonly state: AnalyzerState;
  readonly installed?: string;
  readonly required?: string;
  readonly suggested?: string;
  readonly errors: readonly AnalysisError[];
  readonly scannedAt?: string;
}

const VERSION = /^(?:go)?(\d+)\.(\d+)(?:\.(\d+))?(?:(beta|rc)(\d+))?$/;
```

Run go env GOVERSION GOWORK with the existing runner and environment. Read the first trimmed output line as the installed version, take required/suggested values from positional go/toolchain directives, and return failed with a classified error when the command or version parsing fails.

- [ ] **Step 4: Write failing diagnostic tests**

```ts
assert.equal(mapToolchainDiagnostics(parsed, belowGo)[0]?.severity, vscode.DiagnosticSeverity.Error);
assert.equal(mapToolchainDiagnostics(parsed, belowSuggested)[0]?.severity, vscode.DiagnosticSeverity.Warning);
assert.equal(mapToolchainDiagnostics(parsed, unavailable)[0]?.range.start.line, parsed.module!.range.start.line);
```

- [ ] **Step 5: Implement diagnostic mapping**

Use the go range for an installed version below go, the toolchain range for a version below the suggested toolchain, directive ranges for malformed values, and the module range when Go is unavailable. Set source to modbear and use stable codes go-version, toolchain-version, and toolchain-unavailable.

- [ ] **Step 6: Run focused verification**

Run: npm run test:unit && npm run test:extension

Expected: PASS for release, beta, RC, normalized-prefix, unavailable, and malformed-directive cases.

- [ ] **Step 7: Commit the toolchain phase**

```bash
git add src/domain/analysis.ts src/parsers/goToolchainVersionParser.ts src/analyzers/toolchainAnalyzer.ts src/diagnostics/toolchainDiagnosticMapper.ts src/test
git commit -m "feat: diagnose Go toolchain compatibility"
```

### Task 3: Add explicit explanations and read-only detail documents

**Files:**

- Create: src/analyzers/whyAnalyzer.ts
- Create: src/providers/detailsDocumentProvider.ts
- Test: src/test/integration/whyAnalyzer.test.ts
- Test: src/test/suite/detailsDocument.test.ts

**Interfaces:**

- Produces explainDependency(options): Promise<string>.
- Produces DetailsDocumentProvider.set(kind, id, content): vscode.Uri and provideTextDocumentContent(uri): string.

- [ ] **Step 1: Write failing exact-argument and virtual-document tests**

```ts
assert.deepEqual(recorded.args, ["mod", "why", "-m", "example.com/library"]);
assert.match(provider.provideTextDocumentContent(uri), /Suggested commands are not executed/);
assert.equal(
  provider.provideTextDocumentContent(vscode.Uri.parse("modbear:/missing/item.md")),
  "# ModBear\n\nDetails are no longer available.",
);
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: npm run test:integration -- --test-name-pattern="why"

Expected: FAIL because neither analyzer nor provider exists.

- [ ] **Step 3: Implement the process boundary and provider**

```ts
const result = await runProcess({
  executable: options.goExecutable,
  args: ["mod", "why", "-m", options.modulePath],
  cwd: options.module.moduleRoot,
  env: buildGoEnvironment(),
  timeoutMs: options.timeoutMs,
  stdoutLimitBytes: 10 * 1024 * 1024,
  stderrLimitBytes: 2 * 1024 * 1024,
  signal: options.signal,
});
if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "go mod why failed");
```

The document provider uses URI keys, clears its map on disposal, and prepends the immutable read-only notice to all content passed to set.

- [ ] **Step 4: Add validation tests**

```ts
assert.throws(() => validateAdvisoryUri("https://user:secret@example.test/advisory"));
assert.throws(() => validateAdvisoryUri("command:workbench.action.reloadWindow"));
assert.equal(validateAdvisoryUri("https://pkg.go.dev/example.com/library").scheme, "https");
```

- [ ] **Step 5: Implement validation helpers**

Validate an explanation's module path by finding it in the active snapshot before invoking the analyzer. Parse advisory links with vscode.Uri.parse, reject credentials and non-HTTP schemes, and surface validation failures through the existing redacted logger/error message path.

- [ ] **Step 6: Run focused verification and commit**

Run: npm run test:integration && npm run test:extension

Expected: PASS with no subprocess initiated for invalid or untrusted command requests.

```bash
git add src/analyzers/whyAnalyzer.ts src/providers/detailsDocumentProvider.ts src/test
git commit -m "feat: add read-only dependency details"
```

### Task 4: Compose health phases into scan lifecycle and configuration

**Files:**

- Modify: src/config/defaults.ts
- Modify: src/config/config.ts
- Modify: package.json
- Modify: src/orchestration/moduleScanner.ts
- Modify: src/orchestration/scanCoordinator.ts
- Modify: src/extension.ts
- Test: src/test/unit/moduleScanner.test.ts
- Test: src/test/unit/scanCoordinator.test.ts
- Test: src/test/suite/fullScan.test.ts

**Interfaces:**

- Adds tidyEnabled, tidyTtlMinutes, vulnerabilityTtlMinutes, importedVulnerabilitySeverity, vulnerabilityIncludeTests, vulnerabilityBuildTags, and vulnerabilityDatabase to ExtensionConfig and defaults.
- Extends ModuleScanner.scan(module, signal, trigger), where trigger is "background" | "save" | "manual".

- [ ] **Step 1: Write failing scan-composition tests**

```ts
await scanner.scan(module, new AbortController().signal, "background");
assert.equal(tidyCalls, 0);
await scanner.scan(module, new AbortController().signal, "save");
assert.equal(tidyCalls, 1);
assert.equal(snapshot.toolchain.state, "complete");
assert.equal(snapshot.vulnerabilities.state, "unavailable");
assert.equal(snapshot.dependencies.length, 1);
```

- [ ] **Step 2: Run the focused scan tests to verify they fail**

Run: npm run test:unit -- --test-name-pattern="ModuleScanner|ScanCoordinator"

Expected: FAIL because scan triggers and new phase snapshots do not exist.

- [ ] **Step 3: Add configuration and phase composition**

Add bounded manifest/default settings for scan.vulnerabilityTtlMinutes (360), scan.tidyTtlMinutes (10), tidy.enabled (true), vulnerability.includeTests (false), vulnerability.buildTags ([]), vulnerability.database ("", window scoped), and imported vulnerability severity (warning). Include health configuration, Go executable identity, and the scan trigger's tidy eligibility in cache identity.

Run updates and toolchain in parallel; run existing vulnerability work under its coordinator; include tidy only for save and manual when enabled. Convert individual phase errors to their phase result rather than throwing, so the returned snapshot is partial when at least one phase fails. Retain prior successful phase values as stale in ScanCoordinator when a whole scan cannot produce a snapshot.

- [ ] **Step 4: Pass explicit triggers from extension events**

```ts
const requestScan = async (module: ModuleContext, trigger: ScanTrigger = "background") => {
  const scanner = new ModuleScanner(
    cache,
    goPath,
    config.timeoutSeconds * 1000,
    config.updateTtlMinutes * 60000,
    output,
    vulnerability,
    health,
  );
  return coordinator.scanModule({ module, contentHash: "", run: (signal) => scanner.scan(module, signal, trigger) });
};
vscode.workspace.onDidOpenTextDocument((doc) => triggerScan(doc, "background"));
vscode.workspace.onDidSaveTextDocument((doc) => triggerScan(doc, "save"));
vscode.commands.registerCommand("modBear.scanWorkspace", () => requestScan(module, "manual"));
```

Do not schedule a tidy subprocess from inlay rendering; its implicit scan remains background.

- [ ] **Step 5: Run full scan regression coverage**

Run: npm run test:unit && npm run test:integration && npm run test:extension

Expected: PASS; a missing govulncheck or failed tidy phase leaves update and toolchain results visible, and untrusted workspace tests show no child process invocation.

- [ ] **Step 6: Commit scan integration**

```bash
git add package.json src/config src/orchestration src/extension.ts src/test
git commit -m "feat: integrate module health scan phases"
```

### Task 5: Render merged health results and register detail commands

**Files:**

- Modify: src/providers/inlayLabel.ts
- Modify: src/providers/dependencyInlayHintsProvider.ts
- Modify: src/providers/dependencyHoverProvider.ts
- Modify: src/extension.ts
- Modify: package.json
- Test: src/test/unit/inlayLabel.test.ts
- Test: src/test/suite/inlayHints.test.ts
- Test: src/test/suite/fullScan.test.ts

**Interfaces:**

- Extends buildInlayLabel(status, showKind, findings) with readonly VulnerabilityFinding[].
- Registers modBear.explainDependency, modBear.openAdvisory, and modBear.showTidyDiff.

- [ ] **Step 1: Write failing UI and command tests**

```ts
assert.equal(
  buildInlayLabel(status, true, [{ classification: "reachable", fixedVersion: "v1.2.3" } as VulnerabilityFinding]),
  "🛡 fixed in v1.2.3",
);
assert.equal(
  buildInlayLabel(status, true, [{ classification: "reachable" } as VulnerabilityFinding]),
  "🛡 vulnerable · no fix",
);
assert.match(hover.contents[0]!.value, /Available: .v2.0.0./);
assert.equal(
  diagnostics.some((item) => item.code === "tidy-diff"),
  true,
);
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run: npm run test:unit -- --test-name-pattern="inlay" && npm run test:extension

Expected: FAIL because reachable findings are not included in label selection and the commands are absent.

- [ ] **Step 3: Implement priority, merged diagnostics, and commands**

For every requirement, pass matching vulnerability findings to buildInlayLabel; show reachable vulnerability first, then retracted, deprecated, update, and local replacement. Preserve all lifecycle/update/vulnerability details in hover text.

In the snapshot handler, merge existing update/replacement/vulnerability diagnostics with mapTidyDiagnostic(parsed, snapshot.tidy) and mapToolchainDiagnostics(parsed, snapshot.toolchain) before calling diagnosticManager.set once.

Register the modbear content provider and commands. showTidyDiff opens a provider URI only when a current diff exists. The existing modBear.showDetails command opens a provider URI containing the selected finding's sanitized OSV ID, classification, fixed version, and advisory text. explainDependency checks workspace trust, resolves the requested module from the active snapshot, opens its returned text in a provider URI, and never runs for invalid input. openAdvisory validates the URI then calls vscode.env.openExternal.

- [ ] **Step 4: Add manifest contributions**

```json
{ "command": "modBear.explainDependency", "title": "ModBear: Explain Dependency" },
{ "command": "modBear.openAdvisory", "title": "ModBear: Open Vulnerability Advisory" },
{ "command": "modBear.showTidyDiff", "title": "ModBear: Show Tidy Diff" }
```

Add command-menu visibility only where command arguments are available and retain all command paths behind requireTrustedWorkspace().

- [ ] **Step 5: Run extension regression coverage**

Run: npm run test:extension

Expected: PASS; the full scan fixture retains update text in hover, chooses the security label, contains update/deprecation/tidy diagnostics, and does not mutate the fixture.

- [ ] **Step 6: Commit the user-facing integration**

```bash
git add package.json src/diagnostics src/providers src/extension.ts src/test
git commit -m "feat: surface module health results"
```

### Task 6: Run the health and security release gate

**Files:**

- Modify: docs/superpowers/plans/2026-07-21-modbear-security-health-plan.md
- Modify: docs/superpowers/plans/2026-07-24-security-performance-observability-remediation.md

**Interfaces:**

- Produces updated plan status only after all checks below pass.

- [ ] **Step 1: Run static and automated verification**

Run: npm run check && npm run test:unit && npm run test:integration && npm run test:extension && npm run package

Expected: every command exits 0.

- [ ] **Step 2: Verify no unsafe production operation was introduced**

Run:

```bash
! rg -n 'args: \["mod", "tidy"\](?!, "-diff")|go get|go mod edit|go work edit|go env -w|go install|shell:\s*true' src -g '*.ts'
! rg -n 'WorkspaceEdit|TextEditor\.edit|workspace\.fs\.writeFile' src -g '*.ts'
```

Expected: no production implementation match; manually inspect permitted display-only go get suggestion strings if present.

- [ ] **Step 3: Review packaging and working-tree scope**

Run: npm run test:release && git diff --check && git status --short

Expected: release metadata passes, whitespace is clean, and only intended implementation/plan files are staged for their corresponding commits.

- [ ] **Step 4: Mark plans complete and commit the release gate**

After the verification commands pass, change the original health plan and completed remediation plan status to completed, without altering their historical task text.

```bash
git add docs/superpowers/plans/2026-07-21-modbear-security-health-plan.md docs/superpowers/plans/2026-07-24-security-performance-observability-remediation.md
git commit -m "docs: complete module health plans"
```
