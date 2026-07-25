# Final Review Fix Report — Imported Vulnerability Severity

## Scope

Addressed only the final-review Important finding that
`modBear.diagnostics.importedVulnerabilitySeverity` was validated but had no
effect on emitted diagnostics. No ledger hardening changes were made.

## Root Cause

- `readConfig()` exposed the imported-vulnerability severity setting, but
  `buildSnapshotDiagnostics()` accepted and passed only update severity.
- `mapVulnerabilityDiagnostics()` accepted no configured severity and assigned
  `DiagnosticSeverity.Warning` to every non-reachable finding.

## TDD Evidence

### RED

Added mapper and snapshot-composition coverage for every accepted setting:

- `none` suppresses non-reachable diagnostics.
- `information` emits non-reachable diagnostics at Information severity.
- `warning` emits non-reachable diagnostics at Warning severity.
- Reachable findings remain Error for every setting.

Before implementation, `npm run test:extension` failed during TypeScript
compilation with the expected missing API propagation errors:

- `fullScan.test.ts`: `buildSnapshotDiagnostics` expected 3 arguments but the
  new propagation test supplied 4.
- `vulnerabilityDiagnosticMapper.test.ts`: `mapVulnerabilityDiagnostics`
  expected 2 arguments but the new mapper test supplied 3.

### GREEN

- `buildSnapshotDiagnostics()` now accepts
  `importedVulnerabilitySeverity` and passes it to
  `mapVulnerabilityDiagnostics()`.
- The snapshot event handler supplies the resource-scoped configured value.
- The mapper explicitly suppresses non-reachable findings for `none`, maps
  them to Information for `information`, and maps them to Warning for
  `warning`; reachable findings remain Error.

## Verification

- `npm run test:extension` — 45 passing.
- `npm run test:unit` — 107 passing.
- `npm run check` — exit 0.
- `git diff --check` — exit 0.

## Files Changed

- `src/diagnostics/vulnerabilityDiagnosticMapper.ts`
- `src/extension.ts`
- `src/test/suite/vulnerabilityDiagnosticMapper.test.ts`
- `src/test/suite/fullScan.test.ts`
- This report.
