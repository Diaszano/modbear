# Module Health and Security Completion Design

## Purpose

Complete the remaining module-health work while retaining ModBear's existing vulnerability analysis, strict read-only behavior, and trusted-workspace boundary.

## Scope

- Add read-only `go mod tidy -diff` analysis and a `go.mod` diagnostic when module metadata differs from tidy output.
- Add Go/toolchain compatibility analysis using `go env GOVERSION GOWORK` and the existing positional `go` and `toolchain` directives.
- Add explicit dependency explanations through `go mod why -m` and read-only `modbear:` detail documents for tidy diffs and vulnerability details.
- Integrate the new phase results into immutable module snapshots, diagnostics, hover/inlay priority, configuration, and scan tests.

The existing `govulncheck` parser, analyzer, diagnostics, trust gate, redaction, cache bounds, and lifecycle events remain the baseline; they are not reimplemented.

## Architecture

`ModuleAnalysisSnapshot` gains `tidy` and `toolchain` analysis values. Each result uses the established analyzer state and structured errors, so one failed phase does not suppress successful update or vulnerability data.

`ModuleScanner` reads and hashes the module inputs first. It runs update and toolchain work concurrently, preserves the current single global vulnerability coordinator, and runs tidy only for save and manual scans. If the module input changes during work, the resulting snapshot is discarded. Failed refreshes retain usable prior phase data as stale through the existing coordinator semantics.

All Go commands use the existing shell-free process runner and `buildGoEnvironment`, which appends `-mod=readonly`. The exact permitted health commands are `go mod tidy -diff`, `go env GOVERSION GOWORK`, and user-requested `go mod why -m <validated-module-path>`.

## Tidy Analysis

The tidy parser recognizes only a unified diff as a metadata inconsistency. A clean exit with no output is consistent; all other results are analysis failures. The raw diff is retained only in the snapshot and is exposed through a virtual document. A warning on the module directive tells the user that a read-only diff is available.

Tidy is disabled for open-triggered scans and enabled for save/manual scans. It never applies the diff or edits workspace files. Integration tests hash `go.mod` and `go.sum` before and after execution.

## Toolchain Analysis

The toolchain analyzer parses normalized Go versions, including beta and release-candidate forms, and compares the installed version with `go` and `toolchain` requirements. Diagnostics use the directive ranges already produced by the `go.mod` parser:

- Installed below `go`: error on the `go` directive.
- Installed below `toolchain`: warning on the `toolchain` directive.
- Malformed directive: warning on its directive range.
- Unavailable Go: error on the module directive.

## Detail Documents and Commands

`DetailsDocumentProvider` stores transient content under the `modbear:` scheme and labels every document as read-only. The extension adds commands to explain a dependency, show a tidy diff, and open a vulnerability advisory.

Dependency explanation validates the selected module path against the current snapshot before invoking `go mod why -m`. Advisory links accept only credential-free `http` or `https` URLs. Detail documents and commands never execute suggested update commands.

## UI and Diagnostics

Diagnostic mapping remains separate from analyzers. Per-module diagnostics merge update, replacement, vulnerability, tidy, and toolchain results. Compact inlay labels prioritize reachable vulnerability, then retraction, deprecation, update, and local replacement; hover content retains all applicable states.

Existing vulnerability unavailable state remains explicit and does not remove update, tidy, or toolchain information.

## Configuration and Trust

Configuration adds bounded TTLs and toggles for vulnerability and tidy behavior, plus imported-vulnerability severity. Workspace trust is checked before discovery and every subprocess entry point; untrusted workspaces execute neither Go nor `govulncheck` commands.

## Verification

Unit tests cover tidy classification, version parsing/comparison, toolchain decisions, and URL/module validation. Integration tests assert exact arguments and no fixture mutation. Extension-host tests cover virtual documents, merged diagnostics, inlay priority, partial results, missing `govulncheck`, and the trust boundary.

The final gate runs type checking, unit, integration, extension, and packaging tests, plus focused searches for mutating Go commands and production workspace-write APIs.
