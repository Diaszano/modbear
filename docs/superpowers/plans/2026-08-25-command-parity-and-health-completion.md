# ModBear Command Parity and Module Health Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register every command declared in `package.json`, complete the pending module-health feature set defined in `docs/superpowers/plans/2026-07-25-module-health-security-completion.md` (read-only tidy diagnostics, toolchain compatibility, dependency explanations/details, merged health rendering), and reconcile documentation drift — without weakening workspace-trust gating, privacy, or ModBear's read-only guarantees (never runs `go get`, never writes go.mod/go.sum/go.work).

**Architecture:** Two phases.

- **Phase A (Tasks 1–2): integrity fixes** using existing providers only — restore manifest/command parity and fix stale documentation.
- **Phase B (Tasks 3–8): health completion** porting Tasks 1–6 of the 2026-07-25 completion plan. That document remains the canonical detailed spec (code snippets, exact interfaces); each task below states scope, integration adjustments against CURRENT code state, and exit criteria. Implementers MUST read the referenced original-plan section before coding.

**Tech Stack:** TypeScript 5 strict, Node.js built-in test runner, VS Code Extension API, shell-free Go CLI subprocesses (`go list -u -m -json all`, `go mod tidy -diff`, `go mod why -m`, `go env GOVERSION GOWORK`, govulncheck), existing AnalysisCache/ScanCoordinator infrastructure.

## Global Constraints

- Read-only guarantee: never mutate module files; `go mod tidy -diff` is analysis-only (Go >= 1.23).
- All Go invocations go through existing process runner with timeout + AbortSignal support; no shell interpolation.
- Every new code path reachable from a command or event must no-op safely when the workspace is untrusted (`requireTrustedWorkspace()`).
- Failing test first for every behavioral step; tests must pass without network access (mock process results).
- No TODO/FIXME markers left in src/.
- Conventional Commits; semantic-release consumes them.
- Do not edit `docs/superpowers/plans/2026-07-25-module-health-security-completion.md` until Task 8.

## File Structure

| Path                                         | Change | Purpose                                                                  |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| src/extension.ts                             | modify | register scanModule/showDetails; later merged diagnostics + new commands |
| src/parsers/tidyDiffParser.ts                | add    | parse `go mod tidy -diff` output                                         |
| src/analyzers/tidyAnalyzer.ts                | add    | run tidy diff phase, classify result                                     |
| src/diagnostics/tidyDiagnosticMapper.ts      | add    | map inconsistent-tidy to diagnostic on module directive                  |
| src/parsers/goToolchainVersionParser.ts      | add    | parse Go version strings                                                 |
| src/analyzers/toolchainAnalyzer.ts           | add    | `go env GOVERSION GOWORK` phase                                          |
| src/diagnostics/toolchainDiagnosticMapper.ts | add    | go-version/toolchain diagnostics                                         |
| src/analyzers/whyAnalyzer.ts                 | add    | `go mod why -m <path>` per dependency                                    |
| src/providers/detailsDocumentProvider.ts     | add    | modbear: virtual detail documents                                        |
| src/security/advisoryUri.ts                  | add    | validateAdvisoryUri helper                                               |
| src/orchestration/moduleScanner.ts           | modify | trigger param, parallel phases, partial snapshots                        |
| src/orchestration/scanCoordinator.ts         | modify | stale retention on failed scan                                           |
| src/domain/*.ts                              | modify | TidyAnalysis/ToolchainAnalysis on snapshot                               |
| src/config/config.ts, defaults.ts            | modify | new config keys                                                          |
| package.json                                 | modify | contributes.configuration + commands                                     |
| README.md                                    | modify | engines version fix                                                      |
| docs/superpowers/plans/*                     | modify | tick shipped checkboxes                                                  |

---

## Task 1: Restore command registration parity (Phase A)

**Files:** Modify `src/extension.ts`. Add `src/test/suite/commandParity.test.ts`.

**Problem:** package.json declares `modBear.scanModule` and `modBear.showDetails`; neither is registered in extension.ts → "command 'modBear.scanModule' not found".

**Interfaces / behavior:**

- Parity regression test: read `package.json` `contributes.commands[].command`, filter `vscode.commands.getCommands()` for `^modBear\.`, assert every declared id is registered after extension activation.
- `modBear.scanModule`: if untrusted → trust prompt flow; if no active editor or active file is not inside a discovered Go module → `showWarningMessage("ModBear: Open a file inside a Go module to scan it.")`; else resolve module via existing discovery and call existing `requestScan(module)` path.
- `modBear.showDetails` (INTERIM — superseded by Task 7): requires trusted workspace; uses latest cached snapshot for the active editor's module; shows a QuickPick listing dependencies: label = modulePath, description = `installed → available (updateKind)` when an update exists, detail = deprecation/retraction/vulnerability summary; picking an updated dependency offers "Copy update command" reusing copySuggestion logic. No subprocesses. When no snapshot exists: informational message advising a scan.

**Steps:**

- [x] Write failing parity + behavior tests
- [x] Register both commands; all tests green
- [x] Verify: `npm run lint && npm run test`
- [x] Commit: `fix: register declared scanModule and showDetails commands`

## Task 2: Documentation reconciliation (Phase A)

**Files:** `README.md`; four historical plan docs.

**Steps:**

- [x] README.md Requirements section: change VS Code `^1.109.0` → `^1.125.0` (match package.json engines)
- [x] Tick implemented checkboxes (`- [ ]` → `- [x]`) in: 2026-07-23 status-bar plan, 2026-07-24 terminal-update-button plan, 2026-07-24 observability-remediation plan, 2026-07-25 cicd-governance plan — verify each feature actually shipped (statusBarManager.ts, terminalUpdateManager.ts, .github workflows exist) before ticking; leave the 2026-07-25 module-health-security-completion.md untouched
- [x] Verify: `npm run format:check` passes; `grep -c "\- \[ \]"` returns 0 for those four files
- [x] Commit: `docs: align readme engines version and mark shipped plans complete`

## Task 3: Tidy analysis phase (Phase B)

**Spec source:** Port **Task 1 of `docs/superpowers/plans/2026-07-25-module-health-security-completion.md` VERBATIM** — read that section before implementing. It defines: `classifyTidyResult(exitCode,stdout,stderr)` → `{clean|diff|error}`; parser/analyzer/mapper files; `go mod tidy -diff` invocation; diagnostic code `tidy-diff` anchored on the module directive; unit/integration tests.

**Integration notes vs current code:**

- Snapshot gains `tidy: TidyAnalysis` field — extend domain types accordingly (Task 6 wires composition; here land types+units).
- Reuse existing ProcessExecutionError handling patterns from updateAnalyzer.

**Exit:** parser/analyzer/mapper + tests exist and pass; no wiring yet beyond domain types.
Commit: `feat: add read-only go mod tidy -diff analysis phase`

## Task 4: Toolchain compatibility phase (Phase B)

**Spec source:** Port **Task 2 of the completion plan VERBATIM** — version regex `/^(?:go)?(\d+)\.(\d+)(?:\.(\d+))?(?:(beta|rc)(\d+))?$/`; parser/analyzer/mapper; `go env GOVERSION GOWORK`; diagnostic codes `go-version`, `toolchain-version`, `toolchain-unavailable`.

**Integration notes:** snapshot gains `toolchain: ToolchainAnalysis`; same staging approach as Task 3 (types + units now, composition in Task 6).

**Exit:** three files + tests pass.
Commit: `feat: add toolchain compatibility analysis`

## Task 5: Dependency explanations and details documents (Phase B)

**Spec source:** Port **Task 3 of the completion plan VERBATIM** — whyAnalyzer via `go mod why -m <path>`; DetailsDocumentProvider on `modbear:` scheme with immutable/read-only notice and map cleanup on disposal; `validateAdvisoryUri` rejecting credentials and non-http(s) schemes.

**Integration notes:** none beyond current state — provider is standalone; registration happens in Task 7.

**Exit:** analyzer/provider/uri-validator + tests pass.
Commit: `feat: add dependency explanations and details document provider`

## Task 6: Scan composition, triggers and configuration (Phase B)

**Spec source:** Port **Task 4 of the completion plan VERBATIM**, adjusted for current signatures:

- Current ctor: `(cache, goExecutable, timeoutMs, ttlMs, logger?, vulnerability?: VulnerabilityScanOptions)`.
- Add `trigger: ScanTrigger = "background"` ("background"|"save"|"manual") as last param of `scan(module, signal)` → `scan(module, signal, trigger)`.
- New ExtensionConfig keys + DEFAULTS: `tidyEnabled:true`, `tidyTtlMinutes:10`, `vulnerabilityTtlMinutes:360`, `importedVulnerabilitySeverity:"warning"`, `vulnerabilityIncludeTests:false`, `vulnerabilityBuildTags:[]`, `vulnerabilityDatabase:""` (window-scoped) + matching `contributes.configuration` entries.
- Cache identity must include new options so config changes invalidate correctly.
- Phases run in parallel: updates/replacements/vulnerabilities (under VulnerabilityCoordinator.run) + tidy (only when `trigger !== "background"` and tidyEnabled) + toolchain. Phase failure → `AnalyzerState:"partial"` snapshot with `errors` populated instead of throwing; cancelled scans still propagate. ScanCoordinator retains previous snapshot flagged `stale` when a whole scan fails.
- Wire triggers: onSave→"save", manual/status-bar & scanModule→"manual", scheduler/onOpen→"background".
- Extend `getSnapshotMetrics` if the completion plan's Task 4 specifies it.

**Exit:** scanner/coordinator/config tests pass incl. partial-failure and trigger-gating cases.
Commit: `feat: compose parallel health phases with trigger-aware scanning`

## Task 7: Merged UI rendering and remaining commands (Phase B)

**Spec source:** Port **Task 5 of the completion plan VERBATIM**: buildInlayLabel priority reachable-vuln > retracted > deprecated > update > replacement; single `diagnosticManager.set` merging update+replacement+vulnerability+tidy+toolchain maps; register `modBear.explainDependency`, `modBear.openAdvisory`, `modBear.showTidyDiff`.

**Integration adjustment (supersedes Task 1 interim):**

- `modBear.showDetails` now opens the DetailsDocumentProvider URI for the picked dependency (replacing the QuickPick-only interim; keep graceful message when no snapshot/provider content).
- Ensure all six declared commands remain registered — rerun Task 1 parity test.

**Exit:** UI merge tests + command behavior tests pass; parity suite green.
Commit: `feat: merge health diagnostics and wire explanation commands`

## Task 8: Release gate and plan closure (Phase B)

**Spec source:** Port **Task 6 of the completion plan VERBATIM** plus:

- Full gate: `npm run check && npm run test:unit && npm run test:integration && npm run test:extension && npm run package`.
- Unsafe-pattern greps (rg) per completion plan (no `go get`, no file writes to module manifests).
- NOW tick every remaining checkbox in `docs/superpowers/plans/2026-07-25-module-health-security-completion.md` and add a completion note; also tick Tasks 1–8 of THIS plan.
- Update CHANGELOG-facing commit history is handled by semantic-release; ensure conventional commits throughout.

**Exit:** all gates green locally; both plans fully ticked.
Commit: `chore: complete module health release gate`

---

## Execution Order & Dependencies

1 → 2 independent of Phase B; 3 → 4 → 5 are independent of each other (can be parallel lanes); 6 depends on 3+4; 7 depends on 5+6; 8 last.

## Final Verification Checklist

- [x] `vscode.commands.getCommands()` covers every package.json-declared modBear id
- [x] README engines == package.json engines
- [x] All plan checkboxes across repo ticked or intentionally deferred with note
- [x] `npm run verify` equivalent full gate green
- [x] No `go get` / module-file mutation anywhere in src/
