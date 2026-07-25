# ModBear Security, Performance, and Observability Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure ModBear reports failed analysis honestly, delivers real vulnerability coverage, remains responsive in large workspaces, and produces useful local redacted operational logs.

**Architecture:** Strengthen the process boundary first: commands produce typed, redacted outcomes and scans retain prior data as stale instead of looking clean after failure. Build `govulncheck` as a separate trusted-workspace analyzer, then make scheduling, output parsing, discovery, and persistent caching bounded. Local structured events consume these typed outcomes without introducing telemetry.

**Tech Stack:** TypeScript 5, Node.js 20+ child processes and filesystem APIs, VS Code Extension API, Go toolchain, `govulncheck` JSON protocol, Node test runner, npm audit.

## Global Constraints

- Do not add remote telemetry, analytics, crash reporting, or new runtime dependencies.
- Never execute a subprocess in an untrusted workspace.
- All subprocesses remain shell-free and use argument arrays.
- Preserve `GOFLAGS=-mod=readonly`; do not mutate `go.mod`, `go.sum`, `go.work`, or Go environment settings.
- Never execute `go get`; terminal suggestions remain validated and use `sendText(command, false)`.
- A cancelled scan is expected control flow, not a user-facing failure.
- Sensitive values must be redacted before reaching an Output Channel, notification, diagnostic, or hover.
- Keep at most 100 persistent analysis snapshots.
- Use conventional commits in English, with one commit per task.

---

## File Structure

| Path                                               | Responsibility                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/execution/processRunner.ts`                   | Shell-free process execution, process-tree termination, output limits, optional incremental stdout consumption. |
| `src/execution/processOutcome.ts`                  | Convert completed process results into typed success/non-zero failures.                                         |
| `src/logging/redaction.ts`                         | Redact URLs, paths, tokens, environment-like secrets, and nested error text.                                    |
| `src/logging/logger.ts`                            | Apply configured log level and emit structured, redacted local events.                                          |
| `src/orchestration/scanCoordinator.ts`             | Preserve prior snapshots as stale on refresh failure and expose typed failure status.                           |
| `src/cache/analysisCache.ts`                       | Versioned, validated, atomic, bounded persistent cache.                                                         |
| `src/execution/goToolIdentity.ts`                  | Resolve and cache the Go executable version used in cache identity.                                             |
| `src/parsers/goListJsonStreamParser.ts`            | Incrementally parse consecutive `go list -json` objects.                                                        |
| `src/parsers/goModDocumentCache.ts`                | Cache parsed `go.mod` positions by URI and document version for UI providers.                                   |
| `src/domain/vulnerability.ts`                      | Vulnerability state, classification, and immutable findings.                                                    |
| `src/parsers/govulncheckJsonParser.ts`             | Validate and parse `govulncheck` JSONL protocol v1.                                                             |
| `src/analyzers/vulnerabilityAnalyzer.ts`           | Run `govulncheck` in a trusted module and return an explicit unavailable state on tool failures.                |
| `src/orchestration/vulnerabilityCoordinator.ts`    | Limit vulnerability scans to one active process.                                                                |
| `src/diagnostics/vulnerabilityDiagnosticMapper.ts` | Map classified vulnerability findings to `go.mod` diagnostics.                                                  |
| `src/discovery/moduleDiscovery.ts`                 | Abortable discovery that records non-fatal subtree failures.                                                    |
| `src/extension.ts`                                 | Per-module scheduling, workspace trust gates, configuration application, snapshot/UI projection.                |

---

### Task 1: Remove false vulnerability claims and remediate audited development dependencies

**Files:**

- Modify: `package.json:4,24-43,192`
- Modify: `README.md:1-50`
- Modify: `docs/architecture.md:1-80`
- Modify: `docs/security.md:1-60`
- Modify: `src/providers/statusBarManager.ts:39-44`
- Modify: `package-lock.json`
- Modify: `scripts/test-release-config.mjs`
- Test: `scripts/test-release-config.mjs`

**Interfaces:**

- Consumes: current user-facing extension metadata.
- Produces: release copy that promises update, deprecation, and retraction analysis only until Task 7 ships; a lockfile without the audited Mocha dependency chain.

- [ ] **Step 1: Add a release-copy regression test**

Add this assertion to `scripts/test-release-config.mjs` after its package metadata checks:

```js
const forbiddenBeforeVulnerabilitySupport = /vulnerability insights|scan(?:ning)? .*vulnerabilit|govulncheck/i;
const packageText = await readFile("package.json", "utf8");
const readmeText = await readFile("README.md", "utf8");
assert.doesNotMatch(packageText, forbiddenBeforeVulnerabilitySupport);
assert.doesNotMatch(readmeText, forbiddenBeforeVulnerabilitySupport);
```

- [ ] **Step 2: Run the regression test to verify it fails**

Run: `npm run test:release`

Expected: FAIL because current package and README claim vulnerability insights or `govulncheck` support.

- [ ] **Step 3: Make the minimum copy and dependency changes**

Replace the package description with `Dependency updates and lifecycle insights for Go modules, directly inside VS Code.` Remove unimplemented `govulncheck` configuration names from `capabilities.untrustedWorkspaces.restrictedConfigurations`, remove vulnerability wording from README, architecture, security documentation, and the scanning status tooltip.

Upgrade the direct test dependency and add narrowly scoped development-only overrides for the vulnerable transitive packages. The stable Mocha release remains `11.7.6`; do not use the `12.0.0-rc.5` prerelease solely to satisfy the audit.

```bash
npm install --save-dev mocha@latest
npm pkg set 'overrides.diff=8.0.4' 'overrides.serialize-javascript=7.0.5'
npm install --package-lock-only
```

Do not run `npm audit fix --force`; it can change unrelated release tooling. The overrides are acceptable only when the full test suite and full `npm audit` pass, proving the stable test runner remains compatible.

- [ ] **Step 4: Verify the release surface and audit result**

Run: `npm run test:release && npm audit --omit=dev && npm audit`

Expected: release test passes; production audit has zero vulnerabilities; the full audit reports zero vulnerabilities.

- [ ] **Step 5: Commit the independently safe release correction**

```bash
git add package.json package-lock.json README.md docs/architecture.md docs/security.md src/providers/statusBarManager.ts scripts/test-release-config.mjs
git commit -m "fix: remove unsupported vulnerability claims"
```

---

### Task 2: Treat non-zero process exits as typed scan failures and terminate process trees

**Files:**

- Modify: `src/execution/processRunner.ts:1-109`
- Create: `src/execution/processOutcome.ts`
- Modify: `src/analyzers/updateAnalyzer.ts:38-60`
- Test: `src/test/integration/processRunner.test.ts`
- Test: `src/test/unit/updateAnalyzer.test.ts`
- Modify: `src/test/fixtures/fake-tool.mjs`

**Interfaces:**

- Consumes: `ProcessResult` from `runProcess`.
- Produces: `requireSuccessfulExit(result, command): ProcessResult`, which throws `ProcessExecutionError` with `kind: "exit-nonzero"` and its attached safe process result.

- [ ] **Step 1: Write failure-first process tests**

Extend `fake-tool.mjs` with:

```js
if (command === "fail") {
  process.stderr.write("proxy https://user:password@example.test failed\\n");
  process.exit(7);
}
```

Then add to `processRunner.test.ts`:

```ts
test("captures a non-zero exit for the caller to classify", async () => {
  const result = await runProcess({
    executable: process.execPath,
    args: [tool, "fail"],
    cwd: process.cwd(),
    timeoutMs: 2_000,
    stdoutLimitBytes: 1024,
    stderrLimitBytes: 1024,
  });
  assert.equal(result.exitCode, 7);
  assert.match(result.stderr, /password/);
});
```

Add an analyzer test asserting that a `go list` exit code of 7 rejects with `ProcessExecutionError` kind `exit-nonzero` rather than returning statuses with empty errors.

- [ ] **Step 2: Run the new tests to verify the analyzer test fails**

Run: `npm run compile && node --test out/test/integration/processRunner.test.js out/test/unit/updateAnalyzer.test.js`

Expected: the process capture test passes; the update analyzer test fails because `exitCode` is currently ignored.

- [ ] **Step 3: Add the explicit outcome helper and use it for `go list`**

Create `src/execution/processOutcome.ts`:

```ts
import { ProcessExecutionError, type ProcessResult } from "./processRunner";

export function requireSuccessfulExit(result: ProcessResult, command: string): ProcessResult {
  if (result.exitCode === 0 && result.signal === null) return result;
  const detail = result.signal
    ? `${command} terminated by ${result.signal}`
    : `${command} exited with code ${result.exitCode ?? "unknown"}`;
  throw new ProcessExecutionError(detail, "exit-nonzero", undefined, result);
}
```

Extend `ProcessExecutionError` with `"exit-nonzero"` and an optional `result?: ProcessResult`, then call `requireSuccessfulExit(result, "go list")` immediately after `runProcess` in `analyzeUpdates` and before `parseGoListJson`.

In `processRunner.ts`, replace direct `child.kill("SIGKILL")` with a `terminateProcessTree(child)` helper. On POSIX spawn the process detached and kill `-child.pid`; on Windows use shell-free `taskkill /pid <pid> /T /F`. Guard missing PIDs and ignore `ESRCH`.

- [ ] **Step 4: Run focused verification**

Run: `npm run compile && node --test out/test/integration/processRunner.test.js out/test/unit/updateAnalyzer.test.js`

Expected: PASS; a non-zero `go list` cannot produce a successful update result.

- [ ] **Step 5: Commit the process contract**

```bash
git add src/execution/processRunner.ts src/execution/processOutcome.ts src/analyzers/updateAnalyzer.ts src/test/integration/processRunner.test.ts src/test/unit/updateAnalyzer.test.ts src/test/fixtures/fake-tool.mjs
git commit -m "fix: classify failed go processes"
```

---

### Task 3: Preserve prior results as stale and make failure state visible

**Files:**

- Modify: `src/orchestration/scanCoordinator.ts:52-90`
- Modify: `src/domain/analysis.ts:42-53`
- Modify: `src/providers/statusBarManager.ts:47-89`
- Modify: `src/extension.ts:64-73,108-130`
- Test: `src/test/unit/scanCoordinator.test.ts`
- Test: `src/test/unit/analysisMetrics.test.ts`

**Interfaces:**

- Consumes: typed process errors from Task 2.
- Produces: a failed initial snapshot or a `stale: true`, `updateState: "partial"` refresh snapshot retaining prior dependencies and replacements.

- [ ] **Step 1: Add the stale-refresh test**

Add this test to `scanCoordinator.test.ts`:

```ts
test("retains the last successful snapshot as stale when refresh fails", async () => {
  const coordinator = new ScanCoordinator();
  await coordinator.scanModule({ module: dummyModule, contentHash: "ok", run: async () => mockSnapshot });
  await assert.rejects(
    coordinator.scanModule({
      module: dummyModule,
      contentHash: "new",
      run: async () => {
        throw new Error("network unavailable");
      },
    }),
  );
  const snapshot = coordinator.getSnapshot(dummyModule.id)!;
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.updateState, "partial");
  assert.deepEqual(snapshot.dependencies, mockSnapshot.dependencies);
  assert.equal(snapshot.errors[0]?.code, "network");
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npm run compile && node --test out/test/unit/scanCoordinator.test.js`

Expected: FAIL because a refresh failure currently replaces the snapshot with an empty `failed` snapshot.

- [ ] **Step 3: Build the stale snapshot in the coordinator**

Inside the non-abort branch of `runScan`, retain `const previous = this.snapshots.get(request.module.id);`. When `previous` exists, publish:

```ts
const staleSnapshot: ModuleAnalysisSnapshot = Object.freeze({
  ...previous,
  contentHash: request.contentHash,
  createdAt: new Date().toISOString(),
  stale: true,
  updateState: "partial",
  errors: [{ code: classifyAnalysisError(err), message: "Dependency refresh failed." }],
});
```

Add `classifyAnalysisError` in `domain/analysis.ts`; map `ProcessExecutionError` kinds to existing domain codes and use `unknown` only for unrecognized errors. Keep raw detail off the snapshot; it belongs only in redacted logs.

Update `StatusBarManager` to render partial/stale snapshots as `$(warning) ModBear: Results may be stale`, and update the snapshot listener to avoid displaying raw error values in VS Code notifications.

- [ ] **Step 4: Run focused tests**

Run: `npm run compile && node --test out/test/unit/scanCoordinator.test.js out/test/unit/analysisMetrics.test.js`

Expected: PASS; cancellation remains absent from user-facing failures.

- [ ] **Step 5: Commit stale-result behavior**

```bash
git add src/orchestration/scanCoordinator.ts src/domain/analysis.ts src/providers/statusBarManager.ts src/extension.ts src/test/unit/scanCoordinator.test.ts src/test/unit/analysisMetrics.test.ts
git commit -m "fix: retain stale snapshots after refresh failures"
```

---

### Task 4: Enforce comprehensive redaction and configured local logging

**Files:**

- Modify: `src/logging/redaction.ts:1-9`
- Modify: `src/logging/logger.ts:1-15`
- Modify: `src/config/config.ts:3-27`
- Modify: `src/extension.ts:33-36,62-72,120-130`
- Test: `src/test/unit/environment.test.ts`
- Create: `src/test/unit/logger.test.ts`

**Interfaces:**

- Consumes: arbitrary command text, stderr, errors, paths, and `modBear.output.logLevel`.
- Produces: `redactLogText(value: string): string` and `Logger.event(level, name, fields)`; neither can emit a raw sensitive value.

- [ ] **Step 1: Write redaction and log-level tests**

Add test cases such as:

```ts
test("redacts credentials and absolute paths in arbitrary log text", () => {
  const value = "go list cwd=/home/alice/private https://u:p@proxy.test token=abc123";
  const result = redactLogText(value);
  assert.doesNotMatch(result, /alice|private|u:p|abc123/);
  assert.match(result, /\[redacted-path\].*https:\/\/\*\*\*@proxy\.test.*token=\*\*\*/);
});
```

Create logger tests using an injected channel double: `debug` events do not emit when configured as `info`, while error events do, and event fields are redacted before the double receives them.

- [ ] **Step 2: Run the new tests to verify failure**

Run: `npm run compile && node --test out/test/unit/environment.test.js out/test/unit/logger.test.js`

Expected: FAIL because current redaction handles only basic-auth URLs and Logger ignores level configuration.

- [ ] **Step 3: Implement a single redaction boundary**

Implement `redactLogText` to apply `redactUrlCredentials`, replace user-home and absolute filesystem paths with `[redacted-path]`, and replace values following keys matching `token|secret|password|authorization|proxy` with `***`. Make `redactCommand` delegate to it.

Refactor `Logger` to accept a `getLevel: () => LogLevel` callback and optional channel factory for tests. Add:

```ts
public event(level: LogLevel, name: string, fields: Readonly<Record<string, string | number | boolean>>): void {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[this.getLevel()]) return;
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${redactLogText(String(value))}`)
    .join(" ");
  this.channel[level](`${name}${body ? ` ${body}` : ""}`);
}
```

Add `logLevel` to `ExtensionConfig` and construct the Logger with `() => readConfig().logLevel`. Route command, scan failures, discovery failures, and process stderr through `event`; do not pass module IDs or raw paths as fields.

- [ ] **Step 4: Verify focused redaction behavior**

Run: `npm run compile && node --test out/test/unit/environment.test.js out/test/unit/logger.test.js`

Expected: PASS; no tested sensitive component reaches the fake output channel.

- [ ] **Step 5: Commit the privacy boundary**

```bash
git add src/logging/redaction.ts src/logging/logger.ts src/config/config.ts src/extension.ts src/test/unit/environment.test.ts src/test/unit/logger.test.ts
git commit -m "fix: redact local scan logs"
```

---

### Task 5: Add the vulnerability protocol model and parser

**Files:**

- Create: `src/domain/vulnerability.ts`
- Create: `src/parsers/govulncheckJsonParser.ts`
- Create: `src/test/fixtures/govulncheck/symbol-stream.jsonl`
- Create: `src/test/fixtures/govulncheck/unknown-fields.jsonl`
- Create: `src/test/unit/govulncheckJsonParser.test.ts`

**Interfaces:**

- Consumes: newline-delimited `govulncheck -format json` messages.
- Produces: `parseGovulncheckStream(input): GovulncheckStream` with protocol v1 config, advisory map, raw findings, and progress messages.

- [ ] **Step 1: Write parser tests and fixtures**

Create a fixture containing config, progress, OSV, and finding messages. Assert protocol parsing, ignored future fields, and rejection of protocol `v2`:

```ts
test("rejects unsupported protocol major versions", () => {
  assert.throws(
    () => parseGovulncheckStream('{"config":{"protocol_version":"v2.0.0"}}\\n'),
    /Unsupported govulncheck protocol/,
  );
});
```

- [ ] **Step 2: Run tests to confirm the missing parser**

Run: `npm run compile`

Expected: FAIL because `domain/vulnerability.ts` and `govulncheckJsonParser.ts` do not exist.

- [ ] **Step 3: Implement validated protocol-v1 parsing**

Define `VulnerabilityClassification` as `"reachable" | "imported" | "module-only" | "unknown"` and a separate `VulnerabilityState` as `"complete" | "unavailable" | "not-run"`.

Parse each non-empty JSONL line as an object. Require exactly one config with `protocol_version` major `1`; retain known fields only; ignore unknown message fields. For each finding, retain OSV ID, fixed version, and trace frames. Reject malformed JSON with a line number. Do not render or log raw advisory text in this task.

- [ ] **Step 4: Run parser verification**

Run: `npm run compile && node --test out/test/unit/govulncheckJsonParser.test.js`

Expected: PASS.

- [ ] **Step 5: Commit protocol support**

```bash
git add src/domain/vulnerability.ts src/parsers/govulncheckJsonParser.ts src/test/fixtures/govulncheck src/test/unit/govulncheckJsonParser.test.ts
git commit -m "feat: parse govulncheck protocol"
```

---

### Task 6: Run and classify `govulncheck` only in trusted workspaces

**Files:**

- Create: `src/analyzers/vulnerabilityAnalyzer.ts`
- Create: `src/analyzers/vulnerabilityAggregator.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/config.ts`
- Modify: `package.json:36-111`
- Modify: `src/domain/analysis.ts`
- Modify: `src/orchestration/moduleScanner.ts`
- Modify: `src/extension.ts`
- Test: `src/test/unit/vulnerabilityAnalyzer.test.ts`
- Test: `src/test/unit/vulnerabilityAggregator.test.ts`
- Test: `src/test/suite/trust.test.ts`

**Interfaces:**

- Consumes: a module root, validated `govulncheck` path, `AbortSignal`, and JSONL parser from Task 5.
- Produces: `VulnerabilityAnalysis { state, findings, errors }`; it is `unavailable`, never clean, when tool resolution or execution fails.

- [ ] **Step 1: Add behavior tests**

Use the fake tool to emit the fixture stream. Add tests asserting a trace with a user-code frame is `reachable`, a package-only trace is `imported`, a module-only trace is `module-only`, and an empty trace is `unknown`. Add a missing executable test:

```ts
assert.deepEqual(result, {
  state: "unavailable",
  findings: [],
  errors: [{ code: "tool-not-found", message: "Vulnerability analysis is unavailable." }],
});
```

Extend the extension-host trust test to assert that a fake `govulncheck` executable was not invoked while `workspace.isTrusted` is false.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile`

Expected: FAIL because the analyzer, configuration, and snapshot field do not exist.

- [ ] **Step 3: Implement analyzer isolation and settings**

Add these restricted settings to `package.json` and `readConfig`:

```json
"modBear.govulncheck.path": { "type": "string", "default": "govulncheck", "scope": "window" },
"modBear.vulnerability.enabled": { "type": "boolean", "default": true },
"modBear.vulnerability.timeoutSeconds": { "type": "number", "default": 600, "minimum": 30, "maximum": 1800 }
```

Add `"modBear.govulncheck.path"` to `capabilities.untrustedWorkspaces.restrictedConfigurations`; do not add the non-existent `modBear.vulnerability.database` setting.

Resolve the executable with `resolveTool`, execute `["-format", "json", "-scan", "symbol", "./..."]` via Task 2's process boundary, and parse it with Task 5. A non-zero exit with valid protocol output is parsed, but a spawn, timeout, unsupported protocol, invalid JSON, or absent executable returns `state: "unavailable"` with a generic public message and a redacted local log event.

Extend `ModuleAnalysisSnapshot` with `vulnerabilities: VulnerabilityAnalysis`. Use a dedicated `VulnerabilityCoordinator` semaphore with max concurrency one, so normal update concurrency does not start multiple expensive vulnerability scans. Construct and invoke it only after the workspace-trust guard passes.

- [ ] **Step 4: Verify analyzer and trust boundaries**

Run: `npm run compile && node --test out/test/unit/vulnerabilityAnalyzer.test.js out/test/unit/vulnerabilityAggregator.test.js && npm run test:extension`

Expected: PASS; untrusted workspaces invoke neither Go nor `govulncheck`.

- [ ] **Step 5: Commit the trusted vulnerability analyzer**

```bash
git add src/analyzers/vulnerabilityAnalyzer.ts src/analyzers/vulnerabilityAggregator.ts src/config/defaults.ts src/config/config.ts package.json src/domain/analysis.ts src/orchestration/moduleScanner.ts src/extension.ts src/test/unit/vulnerabilityAnalyzer.test.ts src/test/unit/vulnerabilityAggregator.test.ts src/test/suite/trust.test.ts
git commit -m "feat: analyze Go vulnerabilities in trusted workspaces"
```

---

### Task 7: Surface vulnerability state safely and restore accurate product copy

**Files:**

- Create: `src/diagnostics/vulnerabilityDiagnosticMapper.ts`
- Modify: `src/diagnostics/diagnosticManager.ts`
- Modify: `src/providers/dependencyHoverProvider.ts`
- Modify: `src/providers/statusBarManager.ts`
- Modify: `src/extension.ts`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `package.json`
- Modify: `scripts/test-release-config.mjs`
- Test: `src/test/suite/vulnerabilityDiagnosticMapper.test.ts`
- Test: `src/test/suite/inlayHints.test.ts`

**Interfaces:**

- Consumes: `VulnerabilityAnalysis` from Task 6 and parsed `go.mod` requirements.
- Produces: diagnostic severity and UI state that distinguishes findings from unavailable analysis.

- [ ] **Step 1: Add mapping and unavailable-state tests**

Add tests that expect reachable findings to be `DiagnosticSeverity.Error`, imported and module-only findings to be warnings, and unavailable analysis to add no false “clean” diagnostic. Verify hover text includes `Vulnerability analysis unavailable` when the state is unavailable.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run compile`

Expected: FAIL because the mapper and UI projection do not exist.

- [ ] **Step 3: Implement diagnostic and UI projection**

Map only findings with a module path matching a `go.mod` requirement. Escape all advisory text with the existing Markdown escaping function and keep `MarkdownString.isTrusted = false`. Add vulnerability counts to status-bar metrics only for complete analysis; render `$(question) ModBear: Vulnerability analysis unavailable` when the analyzer cannot run.

Restore the vulnerability wording removed in Task 1 only after these tests pass. Replace Task 1's release assertion with positive checks for `govulncheck` settings and explicit unavailable-state wording; do not claim all modules are free of vulnerabilities.

- [ ] **Step 4: Verify user-facing behavior**

Run: `npm run compile && npm run test:extension && npm run test:release`

Expected: PASS; UI labels distinguish discovered findings, no findings, and unavailable coverage.

- [ ] **Step 5: Commit UI and documentation accuracy**

```bash
git add src/diagnostics/vulnerabilityDiagnosticMapper.ts src/diagnostics/diagnosticManager.ts src/providers/dependencyHoverProvider.ts src/providers/statusBarManager.ts src/extension.ts README.md docs/architecture.md docs/security.md package.json scripts/test-release-config.mjs src/test/suite/vulnerabilityDiagnosticMapper.test.ts src/test/suite/inlayHints.test.ts
git commit -m "feat: surface vulnerability findings"
```

---

### Task 8: Eliminate cross-module debounce loss and harden discovery/configuration flow

**Files:**

- Modify: `src/extension.ts:42-151`
- Modify: `src/discovery/moduleDiscovery.ts:13-82`
- Modify: `src/providers/dependencyInlayHintsProvider.ts:20-76`
- Test: `src/test/unit/moduleDiscovery.test.ts`
- Test: `src/test/suite/inlayHints.test.ts`
- Create: `src/test/unit/scanScheduling.test.ts`

**Interfaces:**

- Consumes: module IDs and VS Code open/save events.
- Produces: one debounce timer per module, cancellation on deactivate, explicit discovery result `{ modules, errors }`, and no scans when `modBear.enabled` is false.

- [ ] **Step 1: Write scheduling and discovery failure tests**

Add a fake timer test that schedules modules `a` and `b` within 500ms and verifies both callbacks run once. Add a test that schedules `a` twice and verifies only its first timer is replaced. Add a discovery test using an unreadable or removed child directory and assert that a sibling `go.mod` remains discovered.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run compile && node --test out/test/unit/scanScheduling.test.js out/test/integration/moduleDiscovery.test.js`

Expected: FAIL because the extension has one global timeout and discovery rejects on directory errors.

- [ ] **Step 3: Implement module-scoped scheduling and resilient discovery**

Replace `let scanTimeout` with `const scanTimeouts = new Map<string, NodeJS.Timeout>()`. In `triggerScan`, check `config.enabled`, clear only `scanTimeouts.get(module.id)`, set the replacement, and remove it when its callback begins. Dispose all remaining timers through a `Disposable` registered in `context.subscriptions`.

Change discovery to return:

```ts
export interface ModuleDiscoveryResult {
  readonly modules: readonly ModuleContext[];
  readonly errors: readonly Error[];
}
```

Catch `opendir`, `realpath`, and per-entry errors inside `walk`; append a generic error and continue sibling traversal. Preserve abort behavior by rethrowing when `signal.aborted`. In activation and manual scan, catch the discovery promise, send a redacted warning event, set discovered modules, then refresh inlays for already-open `go.mod` documents.

- [ ] **Step 4: Verify scheduling and discovery**

Run: `npm run compile && node --test out/test/unit/scanScheduling.test.js out/test/integration/moduleDiscovery.test.js && npm run test:extension`

Expected: PASS; a module loaded while initial discovery is pending is refreshed after discovery completes.

- [ ] **Step 5: Commit scheduler and discovery resilience**

```bash
git add src/extension.ts src/discovery/moduleDiscovery.ts src/providers/dependencyInlayHintsProvider.ts src/test/unit/moduleDiscovery.test.ts src/test/suite/inlayHints.test.ts src/test/unit/scanScheduling.test.ts
git commit -m "fix: schedule scans independently per module"
```

---

### Task 9: Cache parsed Go module documents and use indexed snapshot lookups

**Files:**

- Create: `src/parsers/goModDocumentCache.ts`
- Modify: `src/providers/dependencyInlayHintsProvider.ts`
- Modify: `src/providers/dependencyHoverProvider.ts`
- Modify: `src/extension.ts:108-130`
- Test: `src/test/unit/goModDocumentCache.test.ts`
- Test: `src/test/suite/inlayHints.test.ts`

**Interfaces:**

- Consumes: a VS Code `TextDocument`, its `uri.toString()`, and `version`.
- Produces: `GoModDocumentCache.get(document): ParsedGoMod`, returning the same parsed positions for an unchanged document and reparsing only when its version changes.

- [ ] **Step 1: Write provider-cache and lookup-complexity tests**

Create a test with a document double whose `getText` call count is observable:

```ts
const cache = new GoModDocumentCache();
cache.get(document);
cache.get(document);
assert.equal(getTextCalls, 1);
document.version = 2;
cache.get(document);
assert.equal(getTextCalls, 2);
```

Extend inlay and diagnostic tests with 100 requirements and 100 statuses, then assert the code constructs a `Map` lookup once rather than calling `.find` inside the requirement loop. Use a spy wrapper around the status collection if a direct operation-count assertion is impractical.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run compile && node --test out/test/unit/goModDocumentCache.test.js && npm run test:extension`

Expected: FAIL because every hover, inlay request, and snapshot event reparses the document, and diagnostic mapping repeatedly scans the dependency array.

- [ ] **Step 3: Implement version-scoped parsing and maps**

Create `GoModDocumentCache` with this shape:

```ts
interface CachedDocument {
  readonly version: number;
  readonly parsed: ReturnType<typeof parseGoModPositions>;
}

export class GoModDocumentCache {
  private readonly entries = new Map<string, CachedDocument>();
  public get(document: vscode.TextDocument): CachedDocument["parsed"] {
    const key = document.uri.toString();
    const current = this.entries.get(key);
    if (current?.version === document.version) return current.parsed;
    const parsed = parseGoModPositions(document.getText());
    this.entries.set(key, { version: document.version, parsed });
    return parsed;
  }
  public delete(uri: vscode.Uri): void {
    this.entries.delete(uri.toString());
  }
  public clear(): void {
    this.entries.clear();
  }
}
```

Inject one shared cache into the hover and inlay providers and use it from the snapshot listener. In `extension.ts`, create `const dependenciesByPath = new Map(snapshot.dependencies.map(status => [status.modulePath, status]));` and use `.get(req.modulePath)` while mapping diagnostics. Register document-close cleanup and dispose the cache with the extension context.

- [ ] **Step 4: Verify UI parsing behavior**

Run: `npm run compile && node --test out/test/unit/goModDocumentCache.test.js && npm run test:extension`

Expected: PASS; the same document version is parsed once per cache lifetime and diagnostics use indexed dependency lookup.

- [ ] **Step 5: Commit editor-provider optimization**

```bash
git add src/parsers/goModDocumentCache.ts src/providers/dependencyInlayHintsProvider.ts src/providers/dependencyHoverProvider.ts src/extension.ts src/test/unit/goModDocumentCache.test.ts src/test/suite/inlayHints.test.ts
git commit -m "perf: cache parsed Go module documents"
```

---

### Task 10: Stream Go list output and bound cache growth

**Files:**

- Modify: `src/execution/processRunner.ts`
- Create: `src/parsers/goListJsonStreamParser.ts`
- Modify: `src/analyzers/updateAnalyzer.ts`
- Modify: `src/cache/analysisCache.ts`
- Modify: `src/cache/cacheKey.ts`
- Create: `src/execution/goToolIdentity.ts`
- Modify: `src/orchestration/moduleScanner.ts`
- Test: `src/test/unit/goListJsonStreamParser.test.ts`
- Test: `src/test/unit/cacheKey.test.ts`
- Test: `src/test/unit/analysisCache.test.ts`

**Interfaces:**

- Consumes: byte chunks from `go list -json` and cacheable snapshots.
- Produces: incremental `GoListJsonStreamParser`, atomic cache entries with schema `2`, and deterministic pruning to 100 snapshots.

- [ ] **Step 1: Write parser and cache-limit tests**

Add a chunk-boundary test that splits a JSON object inside an escaped string and expects the same module array as one complete chunk. Add tests that write 101 snapshots with increasing timestamps and assert only 100 remain, that a truncated JSON cache file is ignored, and that changing `GOPROXY` changes the cache key.

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm run compile && node --test out/test/unit/goListJsonStreamParser.test.js out/test/unit/analysisCache.test.js out/test/unit/cacheKey.test.js`

Expected: FAIL because output is buffered in full and the cache has neither schema validation nor pruning.

- [ ] **Step 3: Implement incremental output and cache schema 2**

Add optional process options:

```ts
readonly onStdoutChunk?: (chunk: Buffer) => void;
readonly collectStdout?: boolean;
```

When `collectStdout` is false, enforce the existing byte counter but do not append chunks. `analyzeUpdates` supplies `collectStdout: false`, feeds chunks to `GoListJsonStreamParser.push`, calls `finish()` only after `requireSuccessfulExit`, and passes the parser results to `analyzeUpdateOutput`.

Implement the stream parser with `depth`, `inString`, `escaped`, and a buffered unconsumed prefix; parse each balanced top-level object immediately and discard it.

Upgrade cache envelopes to `{ schema: 2, snapshot, lastAccessedAt }`. Validate every required snapshot field before returning it. Write to `${key}.json.tmp`, `rename` it to `${key}.json`, then prune JSON entries ordered by `lastAccessedAt` ascending. Ignore and delete corrupt entries. Limit pruning to files matching `/^[a-f0-9]{64}\\.json$/`.

Add selected resolution inputs to `createCacheKey`: `GOFLAGS`, `GOPROXY`, `GONOPROXY`, `GOPRIVATE`, `GOSUMDB`, `GONOSUMDB`, and the cached result of `go version`. Hash values only; never log them.

- [ ] **Step 4: Run focused performance/resilience verification**

Run: `npm run compile && node --test out/test/unit/goListJsonStreamParser.test.js out/test/unit/analysisCache.test.js out/test/unit/cacheKey.test.js out/test/unit/updateAnalyzer.test.js`

Expected: PASS; the updater no longer constructs a full stdout string and cache size stays at or below 100.

- [ ] **Step 5: Commit bounded processing and cache**

```bash
git add src/execution/processRunner.ts src/parsers/goListJsonStreamParser.ts src/analyzers/updateAnalyzer.ts src/cache/analysisCache.ts src/cache/cacheKey.ts src/execution/goToolIdentity.ts src/orchestration/moduleScanner.ts src/test/unit/goListJsonStreamParser.test.ts src/test/unit/cacheKey.test.ts src/test/unit/analysisCache.test.ts
git commit -m "perf: bound Go scan memory and cache growth"
```

---

### Task 11: Publish structured local lifecycle events and run the release gate

**Files:**

- Modify: `src/logging/logger.ts`
- Modify: `src/extension.ts`
- Modify: `src/orchestration/moduleScanner.ts`
- Modify: `src/orchestration/scanCoordinator.ts`
- Modify: `README.md`
- Modify: `docs/security.md`
- Test: `src/test/unit/logger.test.ts`
- Test: `src/test/unit/scanCoordinator.test.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: typed process outcomes, cache hit/miss information, scan states, and configured log level.
- Produces: local `scan.started`, `scan.finished`, and `scan.failed` events with only aggregate/redacted fields.

- [ ] **Step 1: Add lifecycle event assertions**

Extend the logger double tests to assert these exact event names and required fields:

```ts
assert.match(messages[0]!, /^scan\.started kind=updates cache=(hit|miss)$/);
assert.match(messages[1]!, /^scan\.finished outcome=success durationMs=\d+ dependencies=\d+$/);
assert.match(messages[2]!, /^scan\.failed kind=exit-nonzero durationMs=\d+ exitCode=7 stderr=/);
assert.doesNotMatch(messages.join("\\n"), /\/home\/|example\.com\/private|password/);
```

- [ ] **Step 2: Run tests to verify the missing events**

Run: `npm run compile && node --test out/test/unit/logger.test.js out/test/unit/scanCoordinator.test.js`

Expected: FAIL because commands are logged without outcome, duration, cache state, or typed failure information.

- [ ] **Step 3: Emit events only at trusted aggregation boundaries**

Have `ModuleScanner.scan` emit `scan.started` before cache lookup, `scan.finished` with `durationMs`, `cache`, and dependency count on success, and `scan.failed` in a catch block using Task 4 redaction and Task 2 error kind. Never attach module ID, module path, CWD, executable, raw environment, or advisory text. Make `ScanCoordinator` emit a separate debug event for cancellation only.

Document that logs are local, controlled by `modBear.output.logLevel`, and contain no telemetry. Add a CI `npm audit` step after `npm ci` in the dependency-review job so future vulnerable development lockfile changes fail before release.

- [ ] **Step 4: Run the complete release gate**

Run: `npm audit && npm run check && npm test && npm run test:extension && npm run test:release && npm run package:vsix`

Expected: every command exits 0; no output channel test includes a path, private module identifier, or credential.

- [ ] **Step 5: Commit observability and CI enforcement**

```bash
git add src/logging/logger.ts src/extension.ts src/orchestration/moduleScanner.ts src/orchestration/scanCoordinator.ts README.md docs/security.md src/test/unit/logger.test.ts src/test/unit/scanCoordinator.test.ts .github/workflows/ci.yml
git commit -m "feat: add redacted scan lifecycle events"
```

---

## Final Verification Checklist

- [ ] `git diff --check`
- [ ] `npm audit --omit=dev`
- [ ] `npm audit`
- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run test:extension`
- [ ] `npm run test:release`
- [ ] `npm run package:vsix`
- [ ] Manual VS Code check in a trusted Go workspace: success, stale failure, unavailable `govulncheck`, and vulnerability finding states are visually distinct.
- [ ] Manual VS Code check in an untrusted workspace: no Go, `govulncheck`, terminal preparation, or filesystem discovery process is started.
