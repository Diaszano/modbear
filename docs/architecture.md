# ModBear Architecture Overview

This document outlines the software architecture, design principles, and component interactions of the ModBear VS Code extension for Plan 1 (Foundation and Inlay Hints).

## System Architecture

ModBear is built as an event-driven, decoupled VS Code extension. It provides real-time dependency analysis and inlay hint overlays without interfering with language server features or editing workspace files.

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

### 4. Analysis Cache (`src/cache/analysisCache.ts`)
- Provides two-tier caching (memory + global storage disk).
- Computes deterministic cache keys using module paths, `go.mod` content hashes, and settings.
- Bypasses subprocess execution when valid snapshots exist within `modBear.scan.updateTtlMinutes`.

### 5. `go.mod` Position Parser (`src/parsers/goModPositionParser.ts`)
- Parses requirement lines (`require (...)`), direct/indirect flags, and replace directives (`replace (...)`).
- Determines exact character offsets and line ranges for placing inlay hints and diagnostics accurately.

### 6. UI Providers (`src/providers/` & `src/diagnostics/`)
- **`DependencyInlayHintsProvider`**: Renders non-intrusive inlay hints (`→ v1.2.3 · minor`, `⚠ deprecated`, `⚠ retracted`) at line end positions without altering source text.
- **`DependencyHoverProvider`**: Provides Markdown hover details showing installed versions, available updates, deprecation warnings, retraction rationales, and copyable update commands.
- **`DiagnosticManager`**: Publishes VS Code diagnostics to the Problems pane for deprecated or retracted dependencies.

## Data Flow

1. **Trigger**: User opens or saves a `go.mod` file, or invokes `modBear.scanWorkspace`.
2. **Trust Guard**: Verifies `vscode.workspace.isTrusted`. If untrusted, execution aborts safely.
3. **Cache Lookup**: `ScanCoordinator` checks `AnalysisCache`. If cached snapshot is valid, UI updates immediately.
4. **Subprocess Execution**: If uncached or stale, `ModuleScanner` spawns `go list -u -m -json all` with `GOFLAGS=-mod=readonly`.
5. **Parse & Map**: Output JSON stream is parsed, updates are classified (patch, minor, major), and snapshot is saved.
6. **UI Refresh**: `ScanCoordinator` fires snapshot events, causing `InlayHintsProvider` and `DiagnosticManager` to update editor overlays.
