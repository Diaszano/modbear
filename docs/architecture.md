# ModBear Architecture Overview

This document outlines the software architecture, design principles, and component interactions of the ModBear VS Code extension for Plan 1 (Foundation and Inlay Hints).

## System Architecture

ModBear is built as an event-driven, decoupled VS Code extension. It provides available-update, deprecation, and retraction analysis with inlay hint overlays without interfering with language server features or editing workspace files.

```
+-------------------------------------------------------------------+
|                        VS Code Extension Host                     |
|                                                                   |
|   +-------------------+        +------------------------------+   |
|   | ExtensionContext  |        |    Workspace Trust Guard     |   |
|   +---------+---------+        +--------------+---------------+   |
|             |                                 |                   |
|             v                                 v                   |
|   +-----------------------------------------------------------+   |
|   |                     ScanCoordinator                       |   |
|   |   (Concurrency control, queueing, AbortSignal handling)   |   |
|   +-------+---------------------------+-------------------+---+   |
|           |                           |                   |       |
|           v                           v                   v       |
|   +---------------+           +---------------+   +-----------+   |
|   | ModuleScanner |           | AnalysisCache |   | GoMod     |   |
|   | (go list)     |           | (Disk/Memory) |   | Parser    |   |
|   +-------+-------+           +---------------+   +-----+-----+   |
|           |                                             |         |
|           v                                             v         |
|   +---------------+                           +---------------+   |
|   | Subprocess    |                           | InlayHints /  |   |
|   | (execFile)    |                           | Diagnostics   |   |
|   +---------------+                           +---------------+   |
+-------------------------------------------------------------------+
```

## Core Components

### 1. Extension Controller (`src/extension.ts`)
- Serves as the extension entry point (`activate` / `deactivate`).
- Registers VS Code providers (`InlayHintsProvider`, `HoverProvider`), diagnostics managers, and commands.
- Monitors workspace events (`onDidOpenTextDocument`, `onDidSaveTextDocument`) and manages Workspace Trust verification.

### 2. Scan Coordinator (`src/orchestration/scanCoordinator.ts`)
- Manages scan task lifecycle across workspace modules.
- Controls scan queueing to respect `modBear.scan.maxConcurrentModules`.
- Cancels obsolete scan jobs via `AbortController` / `AbortSignal` when new document edits or scan requests arrive.
- Maintains snapshot state and notifies UI providers on scan completion.

### 3. Module Scanner (`src/orchestration/moduleScanner.ts` & `src/execution/`)
- Executes shell-free child process calls to `go list -u -m -json all` using `child_process.execFile`.
- Streams and parses concatenated JSON module metadata objects (`GoListModuleJson`).
- Implements strict execution timeout safeguards (`modBear.scan.timeoutSeconds`).
- Injects `GOFLAGS=-mod=readonly` to ensure Go toolchain operations never mutate `go.mod` or `go.sum`.

### 4. Vulnerability Analyzer (`src/analyzers/vulnerabilityAnalyzer.ts`)
- Executes `govulncheck -format json -scan symbol ./...` shell-free.
- Parses vulnerability findings and classifies trace paths as `reachable`, `imported`, or `module-only`.
- Surfaces findings to diagnostics via `vulnerabilityDiagnosticMapper.ts` and shows detailed advisories on hover cards.
- Restricts parallel scans via `VulnerabilityCoordinator` to bound CPU utilization.

### 5. Analysis Cache (`src/cache/analysisCache.ts`)
- Provides two-tier caching (memory + global storage disk).
- Computes deterministic cache keys using module paths, `go.mod` content hashes, and settings.
- Bypasses subprocess execution when valid snapshots exist within `modBear.scan.updateTtlMinutes`.

### 6. `go.mod` Position Parser (`src/parsers/goModPositionParser.ts`)
- Parses requirement lines (`require (...)`), direct/indirect flags, and replace directives (`replace (...)`).
- Determines exact character offsets and line ranges for placing inlay hints and diagnostics accurately.

### 7. UI Providers (`src/providers/` & `src/diagnostics/`)
- **`DependencyInlayHintsProvider`**: Renders non-intrusive inlay hints (`→ v1.2.3 · minor`, `⚠ deprecated`, `⚠ retracted`) at line end positions without altering source text.
- **`DependencyHoverProvider`**: Provides Markdown hover details showing installed versions, available updates, deprecation warnings, retraction rationales, suggested update commands, and active vulnerability advisories (or unavailable alerts).
- **`DiagnosticManager`**: Publishes VS Code diagnostics to the Problems pane for deprecated, retracted, or vulnerable dependencies.

## Data Flow

1. **Trigger**: User opens or saves a `go.mod` file, or invokes `modBear.scanWorkspace`.
2. **Trust Guard**: Verifies `vscode.workspace.isTrusted`. If untrusted, execution aborts safely.
3. **Cache Lookup**: `ScanCoordinator` checks `AnalysisCache`. If cached snapshot is valid, UI updates immediately.
4. **Subprocess Execution**: If uncached or stale, `ModuleScanner` spawns `go list` and `govulncheck` in parallel with `GOFLAGS=-mod=readonly` (concurrency for vulnerability scans is restricted globally).
5. **Parse & Map**: Output JSON streams are parsed, updates are classified, vulnerability findings are aggregated and classified (or marked unavailable), and snapshot is saved.
6. **UI Refresh**: `ScanCoordinator` fires snapshot events, causing `InlayHintsProvider`, `HoverProvider` and `DiagnosticManager` to update editor overlays and publish problems.
