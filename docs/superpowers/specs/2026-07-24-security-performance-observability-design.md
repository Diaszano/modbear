# ModBear Security, Performance, and Observability Design

**Status:** Approved design

## Purpose

Make ModBear trustworthy under real Go toolchain failures, implement the vulnerability coverage it advertises, scale safely to larger workspaces, and provide useful local diagnostics without remote telemetry or disclosure of private workspace data.

## Scope and Delivery Order

The work is deliberately split into four independently releasable increments.

1. **Immediate integrity and security** — prevent failed Go commands from producing clean-looking results, preserve prior successful data as stale, redact logs, and remediate audited development dependencies.
2. **Vulnerability analysis** — add trusted-workspace `govulncheck` analysis and communicate unavailable coverage explicitly. Until this increment ships, remove vulnerability claims from user-facing copy.
3. **Performance and cache resilience** — eliminate cross-module debounce cancellation, bound process memory and cache growth, and make discovery cancellation/error handling robust.
4. **Local observability** — emit structured, redacted lifecycle events with timing and classified outcomes, controlled by the existing log-level setting.

No increment may add remote telemetry, automatically execute `go get`, mutate `go.mod`, `go.sum`, or `go.work`, or run subprocesses in an untrusted workspace.

## Execution Model

Every external command returns one of two explicit outcomes:

- **Success:** parsed result, elapsed duration, and safe process metadata.
- **Failure:** a typed category (`spawn`, `exit-nonzero`, `timeout`, `cancelled`, `output-limit`, or `invalid-json`), exit code or signal when available, elapsed duration, and redacted diagnostic output.

`cancelled` is an expected control-flow result. It neither creates user-facing errors nor replaces the most recent successful snapshot. All other failures preserve the prior successful snapshot and expose it as `stale`; when no prior snapshot exists, the module is explicitly failed rather than treated as current.

`go list` must reject non-zero exit codes before JSON parsing. Its stderr is retained only as redacted diagnostic detail. Process-tree termination is required on timeout, cancellation, and output-limit failures so helper processes cannot remain after the extension abandons a scan.

## Vulnerability Coverage

Vulnerability analysis is independent from update analysis. In a trusted workspace, ModBear resolves `govulncheck` from the configured path or `PATH`, then executes its JSON protocol with a dedicated timeout and one-process concurrency limit.

The parsed result classifies findings as reachable, imported, module-only, or unknown. Missing tools, unsupported protocol versions, and command failures produce an explicit `unavailable` state; they never imply that a module has no vulnerabilities. The feature uses the existing read-only environment rules and does not install or download `govulncheck`.

Before this capability is shipped, `package.json`, README, status-bar copy, and other user-facing text must describe dependency updates and lifecycle signals only, not vulnerability insights.

## Cache and Performance Model

The scan scheduler maintains independent debounce state per module ID. A scan request for module A must never cancel a pending request for module B. Existing concurrency limits continue to bound active module scans.

Process output is parsed incrementally or otherwise bounded such that the extension does not retain duplicate full-size buffers and strings. Output and stderr limits remain enforced. Discovery is abortable, catches per-directory filesystem errors, and completes with modules found so far when a non-fatal subtree cannot be read.

Persistent cache entries use a versioned envelope and atomic writes. Cache validity includes module inputs, Go executable identity/version, and only the resolution-affecting environment configuration that can change results. The cache keeps at most 100 snapshots, evicting least-recently-used or oldest entries deterministically. Corrupt, incompatible, expired, or incomplete entries are discarded safely.

## Local Observability and Privacy

ModBear remains telemetry-free. Its Output Channel records structured local events at the configured verbosity, including a redacted module identifier, outcome, failure category, duration, cache hit/miss, exit code/signal, and aggregate dependency counts when applicable.

Examples:

```text
scan.finished outcome=success durationMs=842 dependencies=37 cache=miss
scan.failed kind=exit-nonzero exitCode=1 durationMs=231 stderr="[redacted]"
```

No event may include an unredacted workspace path, private module path, configured executable path, URL credentials, tokens, proxy headers, or raw environment value. Redaction occurs before every message reaches the output channel or UI. The `modBear.output.logLevel` setting determines which events are emitted.

## Tests and Acceptance Criteria

- A non-zero `go list` exit code, termination signal, output limit, timeout, malformed JSON, and spawn failure each produce their designated typed outcome.
- Cancellation creates neither a failure snapshot nor a user-facing warning; a refresh failure retains the prior snapshot as stale.
- Unit tests prove URLs, home/workspace paths, credentials, executable paths, stderr, and nested error messages are redacted.
- Two modules scheduled inside the debounce interval both scan exactly once; superseding requests cancel only the same module.
- Cache tests cover atomic recovery, schema incompatibility, expiry, environment-sensitive keys, and the 100-entry pruning limit.
- `govulncheck` tests cover its four classifications, missing tool, protocol incompatibility, process failure, and untrusted-workspace exclusion.
- `npm audit --omit=dev` reports no production vulnerabilities; full `npm audit` has no known vulnerability after dependency remediation.
- Type checking, unit tests, integration tests, extension-host tests, package validation, and source checks for shell-free/read-only execution pass.

## Non-Goals

- Remote telemetry, analytics, or crash reporting.
- Automatic dependency upgrades or installation of external tools.
- Mutation of Go manifests or Go environment settings.
- Scanning ecosystems other than Go.
