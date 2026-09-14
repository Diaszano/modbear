# Ponytail Over-Engineering Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 17 identified over-engineering artifacts across ModBear, removing unnecessary abstractions, single-caller wrapper files, dead code, and redundant dependencies while preserving 100% of functional capabilities and test coverage.

**Architecture:** Systematic, phased refactoring organized into 17 bite-sized tasks. Each task targets one finding from the Ponytail audit, adhering to YAGNI, standard library / platform primacy, and zero dead code. Changes are tested and verified incrementally with conventional commits.

**Tech Stack:** TypeScript 5 strict, Node.js 24 (native `--strip-types`, `node:fs/promises` glob), VS Code Extension API.

**Spec:** The 17 findings from the Ponytail audit output:

1. `ImmutableMap` hand-rolled wrapper class -> native `Map`/`ReadonlyMap`
2. Dead `parseGoListJson` and duplicate `isGoListModule` -> delete
3. `inlayLabel.ts` single-caller file -> inline into `dependencyInlayHintsProvider.ts`
4. Synchronous `getGoVersionSync` & cache-warming dance -> pass `goVersion` directly into `createCacheKey`
5. `optionalStringProperty` & `optionalNumberProperty` helpers -> inline ternary spreads
6. `goWorkParser.ts` single-caller file -> inline into `moduleDiscovery.ts`
7. `vulnerabilityAggregator.ts` single-caller file -> inline into `vulnerabilityAnalyzer.ts`
8. `DiagnosticManager` wrapper class -> use `vscode.DiagnosticCollection` directly in `extension.ts`
9. `activeModuleResolver.ts` single-caller file -> inline into `moduleDiscovery.ts`
10. `scanEvents.ts` custom EventEmitter subclass -> inline event emitter in `ScanCoordinator`
11. `tidyDiffParser.ts` single-caller file -> inline into `tidyAnalyzer.ts`
12. `processOutcome.ts` single-caller file -> inline into `processRunner.ts`
13. `redactCommand` & `redactLogMessage` unused functions -> delete
14. `DirectiveValue` unused interface -> delete
15. `jiti` dependency -> native Node 24 `--strip-types`
16. `glob` dependency -> native `node:fs/promises` `glob`
17. `metadata.ts` single-constant file -> inline `EXTENSION_ID` into `extension.ts`

## Global Constraints

- No behavioral regressions: all existing extension commands, providers, and outputs remain identical.
- Engine floor: Node.js `>=24 <25`, VS Code `^1.125.0`.
- All subprocess execution remains shell-free with strict timeouts and AbortSignal support.
- Conventional Commits: `refactor(...)`, `chore(...)`, or `test(...)` with semantic-release conventions.
- No `TODO` or `FIXME` comments left behind.

## File Structure

| Action | Path                                            | Purpose                                                    |
| ------ | ----------------------------------------------- | ---------------------------------------------------------- |
| Modify | `package.json`                                  | Remove `glob` and `jiti`; update scripts to native Node 24 |
| Modify | `src/test/suite/index.ts`                       | Import `glob` from `node:fs/promises`                      |
| Modify | `src/domain/module.ts`                          | Delete unused `DirectiveValue`                             |
| Modify | `src/logging/redaction.ts`                      | Delete unused `redactCommand` and `redactLogMessage`       |
| Modify | `src/test/unit/environment.test.ts`             | Remove tests for deleted redaction wrappers                |
| Modify | `src/extension.ts`                              | Inline `EXTENSION_ID`, inline `DiagnosticManager` usage    |
| Delete | `src/metadata.ts`                               | Replaced by inline export in `src/extension.ts`            |
| Modify | `src/test/unit/smoke.test.ts`                   | Update `EXTENSION_ID` import                               |
| Modify | `src/parsers/govulncheckJsonParser.ts`          | Remove `ImmutableMap` & helper functions                   |
| Modify | `src/test/unit/govulncheckJsonParser.test.ts`   | Test `ReadonlyMap` without custom class                    |
| Modify | `src/parsers/goListJsonParser.ts`               | Keep only `GoListModule` interface                         |
| Delete | `src/test/unit/goListJsonParser.test.ts`        | Deleted with dead `parseGoListJson`                        |
| Modify | `src/providers/dependencyInlayHintsProvider.ts` | Inline `buildInlayLabel`                                   |
| Delete | `src/providers/inlayLabel.ts`                   | Inlined into provider                                      |
| Modify | `src/test/unit/inlayLabel.test.ts`              | Import `buildInlayLabel` from provider                     |
| Modify | `src/execution/goToolIdentity.ts`               | Remove `getGoVersionSync`                                  |
| Modify | `src/cache/cacheKey.ts`                         | Accept optional `goVersion` directly                       |
| Modify | `src/orchestration/moduleScanner.ts`            | Capture `goVersion` from `Promise.all`                     |
| Modify | `src/discovery/moduleDiscovery.ts`              | Inline `parseGoWorkUses` and `resolveActiveModule`         |
| Delete | `src/discovery/goWorkParser.ts`                 | Inlined into `moduleDiscovery.ts`                          |
| Delete | `src/discovery/activeModuleResolver.ts`         | Inlined into `moduleDiscovery.ts`                          |
| Modify | `src/test/unit/goWorkParser.test.ts`            | Import from `moduleDiscovery.ts`                           |
| Modify | `src/test/unit/activeModuleResolver.test.ts`    | Import from `moduleDiscovery.ts`                           |
| Modify | `src/analyzers/vulnerabilityAnalyzer.ts`        | Inline `aggregateVulnerabilities`                          |
| Delete | `src/analyzers/vulnerabilityAggregator.ts`      | Inlined into `vulnerabilityAnalyzer.ts`                    |
| Modify | `src/test/unit/vulnerabilityAggregator.test.ts` | Import from `vulnerabilityAnalyzer.ts`                     |
| Delete | `src/diagnostics/diagnosticManager.ts`          | Inlined into `extension.ts`                                |
| Modify | `src/orchestration/scanCoordinator.ts`          | Use `vscode.EventEmitter` / direct event callback          |
| Delete | `src/orchestration/scanEvents.ts`               | Deleted in favor of built-in events                        |
| Modify | `src/analyzers/tidyAnalyzer.ts`                 | Inline `classifyTidyResult`                                |
| Delete | `src/parsers/tidyDiffParser.ts`                 | Inlined into `tidyAnalyzer.ts`                             |
| Modify | `src/test/unit/tidyDiffParser.test.ts`          | Import from `tidyAnalyzer.ts`                              |
| Modify | `src/execution/processRunner.ts`                | Inline `requireSuccessfulExit`                             |
| Delete | `src/execution/processOutcome.ts`               | Inlined into `processRunner.ts`                            |
| Modify | `src/analyzers/updateAnalyzer.ts`               | Import `requireSuccessfulExit` from `processRunner.ts`     |

---

### Task 1: Delete unused `DirectiveValue` interface [Point 14]

**Files:**

- Modify: `src/domain/module.ts:20-24`

**Interfaces:**

- Consumes: None
- Produces: Clean `src/domain/module.ts` without dead exports

- [ ] **Step 1: Verify `DirectiveValue` has zero usages**

Run: `grep -rn "DirectiveValue" src/`
Expected: Only in `src/domain/module.ts`.

- [ ] **Step 2: Remove `DirectiveValue` from `src/domain/module.ts`**

In `src/domain/module.ts`, remove lines 20-24:

```typescript
export interface DirectiveValue {
  readonly value: string;
  readonly range: TextRange;
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npm run check`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/domain/module.ts
git commit -m "refactor(domain): remove unused DirectiveValue interface"
```

---

### Task 2: Delete unused redaction wrappers [Point 13]

**Files:**

- Modify: `src/logging/redaction.ts:13-20`
- Modify: `src/test/unit/environment.test.ts`

**Interfaces:**

- Consumes: None
- Produces: `src/logging/redaction.ts` exporting only `redactUrlCredentials` and `redactLogText`

- [ ] **Step 1: Update unit test to remove dead wrapper checks**

In `src/test/unit/environment.test.ts`, remove test cases that explicitly test `redactCommand` and `redactLogMessage`. Verify that tests for `redactLogText` and `redactUrlCredentials` remain intact.

- [ ] **Step 2: Remove dead functions in `src/logging/redaction.ts`**

In `src/logging/redaction.ts`, delete:

```typescript
export function redactCommand(args: readonly string[]): readonly string[] {
  return args.map((arg) => redactLogText(arg));
}

export function redactLogMessage(message: string): string {
  return redactLogText(message);
}
```

- [ ] **Step 3: Run unit tests and type check**

Run: `npm run check && npm run test:unit:run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/logging/redaction.ts src/test/unit/environment.test.ts
git commit -m "refactor(logging): remove unused redactCommand and redactLogMessage wrappers"
```

---

### Task 3: Inline `EXTENSION_ID` and remove single-constant `metadata.ts` [Point 17]

**Files:**

- Modify: `src/extension.ts:2,34`
- Delete: `src/metadata.ts`
- Modify: `src/test/unit/smoke.test.ts`

**Interfaces:**

- Consumes: None
- Produces: `src/extension.ts` exports `export const EXTENSION_ID = "diaszano.modbear";`

- [ ] **Step 1: Update `src/extension.ts` to define and export `EXTENSION_ID` directly**

Remove `import { EXTENSION_ID } from "./metadata";`.
Add:

```typescript
export const EXTENSION_ID = "diaszano.modbear";
```

- [ ] **Step 2: Delete `src/metadata.ts`**

Run: `rm src/metadata.ts`

- [ ] **Step 3: Update imports in `src/test/unit/smoke.test.ts`**

Change:

```typescript
import { EXTENSION_ID } from "../../metadata";
```

To:

```typescript
import { EXTENSION_ID } from "../../extension";
```

- [ ] **Step 4: Run typecheck and smoke tests**

Run: `npm run check && node --test out/test/unit/smoke.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/test/unit/smoke.test.ts
git rm src/metadata.ts
git commit -m "refactor(metadata): inline EXTENSION_ID into extension.ts"
```

---

### Task 4: Replace hand-rolled `ImmutableMap` with native `Map` [Point 1]

**Files:**

- Modify: `src/parsers/govulncheckJsonParser.ts:13-55, 98-104`
- Modify: `src/test/unit/govulncheckJsonParser.test.ts:54-60`

**Interfaces:**

- Consumes: `advisories = new Map<string, GovulncheckAdvisory>()`
- Produces: `stream.advisories: ReadonlyMap<string, GovulncheckAdvisory>`

- [ ] **Step 1: Update `src/test/unit/govulncheckJsonParser.test.ts`**

Replace the test that asserts custom `ImmutableMap` throwing on mutation with an assertion that `stream.advisories` is a `ReadonlyMap` with correct lookup semantics:

```typescript
test("exposes advisories through a ReadonlyMap", () => {
  const stream = parseGovulncheckStream(fixture("symbol-stream.jsonl"));
  assert.equal(stream.advisories.size, 1);
  assert.equal(stream.advisories.has("GO-2026-0001"), true);
  assert.equal(stream.advisories.get("GO-2026-0001")?.id, "GO-2026-0001");
});
```

- [ ] **Step 2: Delete `ImmutableMap` in `src/parsers/govulncheckJsonParser.ts`**

Delete lines 13-54 (`class ImmutableMap`).
In `parseGovulncheckStream`, return:

```typescript
return Object.freeze({
  config,
  advisories,
  findings: Object.freeze(findings),
  progress: Object.freeze(progress),
});
```

- [ ] **Step 3: Run unit tests**

Run: `node --test 'out/test/unit/govulncheckJsonParser.test.js'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/govulncheckJsonParser.ts src/test/unit/govulncheckJsonParser.test.ts
git commit -m "refactor(parser): replace hand-rolled ImmutableMap with native Map"
```

---

### Task 5: Shrink `optional*Property` boilerplate in `govulncheckJsonParser.ts` [Point 5]

**Files:**

- Modify: `src/parsers/govulncheckJsonParser.ts:123-192, 225-246`

**Interfaces:**

- Consumes: Raw JSON record
- Produces: Parsed config, progress, advisory, trace frames using standard property assignment

- [ ] **Step 1: Simplify property assignments in `parseConfig`, `parseProgress`, `parseAdvisory`, `parseTraceFrame`, and `parsePosition`**

Replace helper invocations `...optionalStringProperty(record, "k", "prop", line, "lbl")` with inline property assignment:

```typescript
function parsePosition(value: unknown, lineNumber: number): GovulncheckPosition {
  const position = record(value, lineNumber, "finding.trace position");
  const filename = optionalString(position, "filename", lineNumber, "finding.trace position");
  const offset = optionalNumber(position, "offset", lineNumber, "finding.trace position");
  const line = optionalNumber(position, "line", lineNumber, "finding.trace position");
  const column = optionalNumber(position, "column", lineNumber, "finding.trace position");
  return Object.freeze({
    ...(filename !== undefined ? { filename } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  });
}
```

Remove `optionalStringProperty` and `optionalNumberProperty`.

- [ ] **Step 2: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/govulncheckJsonParser.test.js'`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/parsers/govulncheckJsonParser.ts
git commit -m "refactor(parser): simplify optional property assignment in govulncheck parser"
```

---

### Task 6: Delete dead `parseGoListJson` and duplicate `isGoListModule` [Point 2]

**Files:**

- Modify: `src/parsers/goListJsonParser.ts:16-53`
- Delete: `src/test/unit/goListJsonParser.test.ts`

**Interfaces:**

- Consumes: None
- Produces: `src/parsers/goListJsonParser.ts` exporting only `interface GoListModule`

- [ ] **Step 1: Delete `parseGoListJson` and `isGoListModule` from `src/parsers/goListJsonParser.ts`**

Keep only the `GoListModule` interface:

```typescript
export interface GoListModule {
  readonly Path: string;
  readonly Version?: string;
  readonly Main?: boolean;
  readonly Indirect?: boolean;
  readonly Dir?: string;
  readonly GoMod?: string;
  readonly GoVersion?: string;
  readonly Update?: { readonly Path: string; readonly Version?: string };
  readonly Replace?: GoListModule;
  readonly Retracted?: readonly string[];
  readonly Deprecated?: string;
  readonly Error?: { readonly Err: string };
}
```

- [ ] **Step 2: Delete `src/test/unit/goListJsonParser.test.ts`**

Run: `rm src/test/unit/goListJsonParser.test.ts`

- [ ] **Step 3: Run unit tests and type checks**

Run: `npm run check && npm run test:unit:run`
Expected: PASS. Stream parser tests continue to test go list JSON streaming.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/goListJsonParser.ts
git rm src/test/unit/goListJsonParser.test.ts
git commit -m "refactor(parser): delete unused parseGoListJson and duplicate type guard"
```

---

### Task 7: Inline `buildInlayLabel` into `dependencyInlayHintsProvider.ts` [Point 3]

**Files:**

- Modify: `src/providers/dependencyInlayHintsProvider.ts:3, 6-25`
- Delete: `src/providers/inlayLabel.ts`
- Modify: `src/test/unit/inlayLabel.test.ts`

**Interfaces:**

- Consumes: `DependencyStatus`, `showKind`, `findings`
- Produces: `buildInlayLabel` exported from `dependencyInlayHintsProvider.ts`

- [ ] **Step 1: Move `buildInlayLabel` into `dependencyInlayHintsProvider.ts`**

In `src/providers/dependencyInlayHintsProvider.ts`:
Add `export function buildInlayLabel(...)` directly into the file.
Remove `import { buildInlayLabel } from "./inlayLabel";`.

- [ ] **Step 2: Delete `src/providers/inlayLabel.ts`**

Run: `rm src/providers/inlayLabel.ts`

- [ ] **Step 3: Update `src/test/unit/inlayLabel.test.ts`**

Change import:

```typescript
import { buildInlayLabel } from "../../providers/dependencyInlayHintsProvider";
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/inlayLabel.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/dependencyInlayHintsProvider.ts src/test/unit/inlayLabel.test.ts
git rm src/providers/inlayLabel.ts
git commit -m "refactor(providers): inline buildInlayLabel into dependencyInlayHintsProvider"
```

---

### Task 8: Eliminate `getGoVersionSync` and synchronous cache-warming dance [Point 4]

**Files:**

- Modify: `src/execution/goToolIdentity.ts:28-44`
- Modify: `src/cache/cacheKey.ts:4-7`
- Modify: `src/orchestration/moduleScanner.ts:103-116`
- Modify: `src/test/unit/cacheKey.test.ts`

**Interfaces:**

- Consumes: `createCacheKey({ ..., goVersion?: string })`
- Produces: Asynchronous `getGoVersion` only, no `spawnSync` fallback

- [ ] **Step 1: Update `createCacheKey` in `src/cache/cacheKey.ts`**

Accept `goVersion` directly in `input`:

```typescript
export function createCacheKey(input: Record<string, unknown>): string {
  const goVersion = (input.goVersion as string | undefined) ?? "";
  const enrichedInput = {
    ...input,
    resolutionInputs: {
      goVersion,
    },
  };
  return createHash("sha256").update(stableStringify(enrichedInput)).digest("hex");
}
```

- [ ] **Step 2: Update `moduleScanner.ts` to pass `goVersion` from `Promise.all`**

```typescript
const [goMod, goSum, goWork, goVersion] = await Promise.all([
  readFile(module.goModPath, "utf8"),
  module.goSumPath ? readFile(module.goSumPath, "utf8").catch(() => "") : Promise.resolve(""),
  module.goWorkPath ? readFile(module.goWorkPath, "utf8").catch(() => "") : Promise.resolve(""),
  getGoVersion(this.goExecutable).catch(() => ""),
]);
```

Pass `goVersion` into `createCacheKey({ ..., goVersion })`.

- [ ] **Step 3: Remove `getGoVersionSync` from `src/execution/goToolIdentity.ts`**

Remove lines 28-44. Also simplify `getGoVersion` to avoid calling `getGoVersionSync` in catch:

```typescript
export async function getGoVersion(goExecutable: string): Promise<string> {
  const cached = versionCache.get(goExecutable);
  if (cached !== undefined) return cached;
  try {
    const result = await runProcess({
      executable: goExecutable,
      args: ["version"],
      cwd: process.cwd(),
      timeoutMs: 5000,
      stdoutLimitBytes: 1024 * 1024,
      stderrLimitBytes: 1024 * 1024,
    });
    const version = result.stdout.trim();
    versionCache.set(goExecutable, version);
    return version;
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/cacheKey.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/execution/goToolIdentity.ts src/cache/cacheKey.ts src/orchestration/moduleScanner.ts
git commit -m "refactor(execution): eliminate synchronous getGoVersionSync and pass goVersion to cacheKey"
```

---

### Task 9: Inline `parseGoWorkUses` into `src/discovery/moduleDiscovery.ts` [Point 6]

**Files:**

- Modify: `src/discovery/moduleDiscovery.ts:4, 110`
- Delete: `src/discovery/goWorkParser.ts`
- Modify: `src/test/unit/goWorkParser.test.ts`

**Interfaces:**

- Consumes: `go.work` file text
- Produces: `parseGoWorkUses` exported from `src/discovery/moduleDiscovery.ts`

- [ ] **Step 1: Move `parseGoWorkUses` into `src/discovery/moduleDiscovery.ts`**

Export `parseGoWorkUses(text: string): readonly string[]` directly from `src/discovery/moduleDiscovery.ts`. Remove import of `parseGoWorkUses` from `./goWorkParser`.

- [ ] **Step 2: Delete `src/discovery/goWorkParser.ts`**

Run: `rm src/discovery/goWorkParser.ts`

- [ ] **Step 3: Update `src/test/unit/goWorkParser.test.ts`**

Change import to:

```typescript
import { parseGoWorkUses } from "../../discovery/moduleDiscovery";
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/goWorkParser.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/moduleDiscovery.ts src/test/unit/goWorkParser.test.ts
git rm src/discovery/goWorkParser.ts
git commit -m "refactor(discovery): inline parseGoWorkUses into moduleDiscovery"
```

---

### Task 10: Inline `aggregateVulnerabilities` into `src/analyzers/vulnerabilityAnalyzer.ts` [Point 7]

**Files:**

- Modify: `src/analyzers/vulnerabilityAnalyzer.ts:8, 40`
- Delete: `src/analyzers/vulnerabilityAggregator.ts`
- Modify: `src/test/unit/vulnerabilityAggregator.test.ts`

**Interfaces:**

- Consumes: `readonly GovulncheckFinding[]`
- Produces: `aggregateVulnerabilities` exported from `src/analyzers/vulnerabilityAnalyzer.ts`

- [ ] **Step 1: Move `aggregateVulnerabilities` and `classifyVulnerability` into `vulnerabilityAnalyzer.ts`**

Place both functions directly in `src/analyzers/vulnerabilityAnalyzer.ts`. Export `aggregateVulnerabilities`.
Remove `import { aggregateVulnerabilities } from "./vulnerabilityAggregator";`.

- [ ] **Step 2: Delete `src/analyzers/vulnerabilityAggregator.ts`**

Run: `rm src/analyzers/vulnerabilityAggregator.ts`

- [ ] **Step 3: Update `src/test/unit/vulnerabilityAggregator.test.ts`**

Update import:

```typescript
import { aggregateVulnerabilities } from "../../analyzers/vulnerabilityAnalyzer";
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/vulnerabilityAggregator.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/vulnerabilityAnalyzer.ts src/test/unit/vulnerabilityAggregator.test.ts
git rm src/analyzers/vulnerabilityAggregator.ts
git commit -m "refactor(analyzers): inline aggregateVulnerabilities into vulnerabilityAnalyzer"
```

---

### Task 11: Replace `DiagnosticManager` wrapper with `vscode.DiagnosticCollection` [Point 8]

**Files:**

- Modify: `src/extension.ts:3, 38, 138, 193`
- Delete: `src/diagnostics/diagnosticManager.ts`

**Interfaces:**

- Consumes: `vscode.languages.createDiagnosticCollection("modbear")`
- Produces: Native `vscode.DiagnosticCollection` usage

- [ ] **Step 1: Update `src/extension.ts` to use `vscode.DiagnosticCollection` directly**

Remove `import { DiagnosticManager } from "./diagnostics/diagnosticManager";`.
Replace:

```typescript
const diagnosticManager = new DiagnosticManager();
```

With:

```typescript
const diagnosticCollection = vscode.languages.createDiagnosticCollection("modbear");
```

In snapshot event:

```typescript
diagnosticCollection.set(doc.uri, diagnostics);
```

In subscriptions:

```typescript
context.subscriptions.push(diagnosticCollection);
```

- [ ] **Step 2: Delete `src/diagnostics/diagnosticManager.ts`**

Run: `rm src/diagnostics/diagnosticManager.ts`

- [ ] **Step 3: Run typecheck and extension tests**

Run: `npm run check`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git rm src/diagnostics/diagnosticManager.ts
git commit -m "refactor(diagnostics): replace DiagnosticManager wrapper with native DiagnosticCollection"
```

---

### Task 12: Inline `resolveActiveModule` into `src/discovery/moduleDiscovery.ts` [Point 9]

**Files:**

- Modify: `src/discovery/moduleDiscovery.ts`
- Modify: `src/extension.ts:22`
- Delete: `src/discovery/activeModuleResolver.ts`
- Modify: `src/test/unit/activeModuleResolver.test.ts`

**Interfaces:**

- Consumes: `documentPath: string`, `modules: readonly ModuleContext[]`
- Produces: `resolveActiveModule` exported from `src/discovery/moduleDiscovery.ts`

- [ ] **Step 1: Move `resolveActiveModule` into `src/discovery/moduleDiscovery.ts`**

Export `resolveActiveModule` from `src/discovery/moduleDiscovery.ts`.
In `src/extension.ts`, change import to:

```typescript
import { discoverModules, resolveActiveModule, type ModuleDiscoveryResult } from "./discovery/moduleDiscovery";
```

- [ ] **Step 2: Delete `src/discovery/activeModuleResolver.ts`**

Run: `rm src/discovery/activeModuleResolver.ts`

- [ ] **Step 3: Update `src/test/unit/activeModuleResolver.test.ts`**

Change import to:

```typescript
import { resolveActiveModule } from "../../discovery/moduleDiscovery";
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/activeModuleResolver.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/discovery/moduleDiscovery.ts src/extension.ts src/test/unit/activeModuleResolver.test.ts
git rm src/discovery/activeModuleResolver.ts
git commit -m "refactor(discovery): inline resolveActiveModule into moduleDiscovery"
```

---

### Task 13: Replace `ScanEvents` with direct callback / EventEmitter [Point 10]

**Files:**

- Modify: `src/orchestration/scanCoordinator.ts:3, 15, 99, 108`
- Modify: `src/extension.ts:178`
- Delete: `src/orchestration/scanEvents.ts`

**Interfaces:**

- Consumes: `ModuleAnalysisSnapshot`
- Produces: `onSnapshot(listener: (snapshot: ModuleAnalysisSnapshot) => void): () => void` directly on `ScanCoordinator`

- [ ] **Step 1: Implement `onSnapshot` directly on `ScanCoordinator`**

In `src/orchestration/scanCoordinator.ts`:
Add a listener set:

```typescript
  private readonly snapshotListeners = new Set<(snapshot: ModuleAnalysisSnapshot) => void>();

  public onSnapshot(listener: (snapshot: ModuleAnalysisSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  private emitSnapshot(snapshot: ModuleAnalysisSnapshot): void {
    for (const listener of this.snapshotListeners) listener(snapshot);
  }
```

Replace `this.events.emitSnapshot(snapshot)` with `this.emitSnapshot(snapshot)`.
Remove `import { ScanEvents } from "./scanEvents";`.

- [ ] **Step 2: Update `src/extension.ts`**

Change `coordinator.events.onSnapshot(...)` to `coordinator.onSnapshot(...)`.

- [ ] **Step 3: Delete `src/orchestration/scanEvents.ts`**

Run: `rm src/orchestration/scanEvents.ts`

- [ ] **Step 4: Run unit tests and typecheck**

Run: `npm run compile && node --test 'out/test/unit/scanCoordinator.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestration/scanCoordinator.ts src/extension.ts
git rm src/orchestration/scanEvents.ts
git commit -m "refactor(orchestration): eliminate ScanEvents subclass in favor of direct onSnapshot listener"
```

---

### Task 14: Inline `classifyTidyResult` into `src/analyzers/tidyAnalyzer.ts` [Point 11]

**Files:**

- Modify: `src/analyzers/tidyAnalyzer.ts:10-13`
- Delete: `src/parsers/tidyDiffParser.ts`
- Modify: `src/test/unit/tidyDiffParser.test.ts`

**Interfaces:**

- Consumes: `exitCode`, `stdout`, `stderr`
- Produces: `classifyTidyResult` and `TidyCommandResult` exported from `tidyAnalyzer.ts`

- [ ] **Step 1: Move `classifyTidyResult` and `TidyCommandResult` into `src/analyzers/tidyAnalyzer.ts`**

Place the definition of `TidyCommandResult` and `classifyTidyResult` directly in `src/analyzers/tidyAnalyzer.ts`.
Remove the import and re-export of `tidyDiffParser`.

- [ ] **Step 2: Delete `src/parsers/tidyDiffParser.ts`**

Run: `rm src/parsers/tidyDiffParser.ts`

- [ ] **Step 3: Update `src/test/unit/tidyDiffParser.test.ts`**

Change import to:

```typescript
import { classifyTidyResult } from "../../analyzers/tidyAnalyzer";
```

- [ ] **Step 4: Run unit tests**

Run: `npm run compile && node --test 'out/test/unit/tidyDiffParser.test.js'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analyzers/tidyAnalyzer.ts src/test/unit/tidyDiffParser.test.ts
git rm src/parsers/tidyDiffParser.ts
git commit -m "refactor(analyzers): inline classifyTidyResult into tidyAnalyzer"
```

---

### Task 15: Inline `requireSuccessfulExit` into `src/execution/processRunner.ts` [Point 12]

**Files:**

- Modify: `src/execution/processRunner.ts`
- Delete: `src/execution/processOutcome.ts`
- Modify: `src/analyzers/updateAnalyzer.ts:5`

**Interfaces:**

- Consumes: `ProcessResult`, `command: string`
- Produces: `requireSuccessfulExit` exported from `src/execution/processRunner.ts`

- [ ] **Step 1: Move `requireSuccessfulExit` into `src/execution/processRunner.ts`**

In `src/execution/processRunner.ts`, add:

```typescript
export function requireSuccessfulExit(result: ProcessResult, command: string): ProcessResult {
  if (result.exitCode === 0 && result.signal === null) return result;
  const detail = result.signal
    ? `${command} terminated by ${result.signal}`
    : `${command} exited with code ${result.exitCode ?? "unknown"}`;
  throw new ProcessExecutionError(detail, "exit-nonzero", undefined, result);
}
```

- [ ] **Step 2: Delete `src/execution/processOutcome.ts`**

Run: `rm src/execution/processOutcome.ts`

- [ ] **Step 3: Update `src/analyzers/updateAnalyzer.ts`**

Change import:

```typescript
import { requireSuccessfulExit, runProcess } from "../execution/processRunner";
```

- [ ] **Step 4: Run unit tests and typecheck**

Run: `npm run check && npm run test:unit:run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/execution/processRunner.ts src/analyzers/updateAnalyzer.ts
git rm src/execution/processOutcome.ts
git commit -m "refactor(execution): inline requireSuccessfulExit into processRunner"
```

---

### Task 16: Replace `glob` dependency with `node:fs/promises` `glob` [Point 16]

**Files:**

- Modify: `src/test/suite/index.ts:3`
- Modify: `package.json:269`

**Interfaces:**

- Consumes: Node 24 native `import { glob } from "node:fs/promises"`
- Produces: 0 external dependencies for test suite discovery

- [ ] **Step 1: Update `src/test/suite/index.ts`**

Change line 3:

```typescript
import { glob } from "node:fs/promises";
```

- [ ] **Step 2: Remove `glob` from `package.json`**

Remove `"glob": "^11.0.0",` from `devDependencies`.
Run: `npm install` (or verify package lock).

- [ ] **Step 3: Verify extension test compilation**

Run: `npm run check && npm run compile`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/test/suite/index.ts package.json package-lock.json
git commit -m "chore(deps): replace glob package with node:fs/promises glob"
```

---

### Task 17: Replace `jiti` with native `node --strip-types` [Point 15]

**Files:**

- Modify: `package.json:226-229, 271`

**Interfaces:**

- Consumes: Node.js 24 native TypeScript execution
- Produces: 0 external dependencies for running `esbuild.ts`

- [ ] **Step 1: Update npm scripts in `package.json`**

Replace:

```json
    "bundle": "jiti esbuild.ts",
    "bundle:prod": "jiti esbuild.ts --production",
    "bundle:analyze": "jiti esbuild.ts --analyze",
    "watch": "jiti esbuild.ts --watch",
```

With:

```json
    "bundle": "node --strip-types esbuild.ts",
    "bundle:prod": "node --strip-types esbuild.ts --production",
    "bundle:analyze": "node --strip-types esbuild.ts --analyze",
    "watch": "node --strip-types esbuild.ts --watch",
```

- [ ] **Step 2: Remove `jiti` from `devDependencies` in `package.json`**

Remove `"jiti": "^2.7.0",`.
Run: `npm install`.

- [ ] **Step 3: Test bundling with native Node 24**

Run: `npm run bundle`
Expected: Output `dist/extension.js` generated cleanly.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): replace jiti with native node --strip-types"
```

---

## Verification Checklist

After all 17 tasks are implemented:

- [ ] `npm run check`: Type checking passes with 0 errors.
- [ ] `npm run lint`: Linting passes with 0 warnings.
- [ ] `npm run format:check`: Code adheres to Prettier formatting.
- [ ] `npm run test:unit`: All unit tests pass.
- [ ] `npm run bundle`: Bundle succeeds using native Node 24.
- [ ] Net line count reduction: ~280 lines cut, 2 devDependencies removed.
