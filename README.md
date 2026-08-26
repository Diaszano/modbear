# ModBear

ModBear provides dependency health, inline update hints, and deprecation/retraction insights for Go modules, directly inside VS Code `go.mod` files.

## What the extension does

ModBear analyzes your Go project dependencies by examining `go.mod` files and inspecting available module versions, deprecation notices, and retractions. It displays inline version hints directly beside your `go.mod` requirement lines, alerts you to retracted or deprecated packages via VS Code diagnostics, and provides hover cards with detailed dependency status. It also diagnoses untidy module metadata and Go toolchain mismatches, and explains dependency relationships on demand.

## Read-only guarantee

> ModBear never runs `go get` automatically and never edits `go.mod`, `go.sum`, or `go.work` itself.

ModBear is safe and non-intrusive. Update suggestions can be displayed, copied, or prepared in an integrated terminal rooted at the owning module. A prepared command is inserted without Enter; only the user can choose to execute it.

## Inline available-version hints

When viewing `go.mod` files, ModBear displays inline inlay hints showing available version updates:

- **Direct dependencies**: Displays available minor, patch, or major updates (e.g. `→ v1.10.1 · minor`).
- **Indirect dependencies**: Configurable display for indirect requirement lines (`// indirect`).
- **Status indicators**: Clear visual badges for deprecations (`⚠ deprecated`) and retractions (`⚠ retracted · → v1.2.0`).
- **Up-to-date dependencies**: Optional checkmark indicator (`✓ current`) for modules already on their latest version.
- **Terminal preparation**: Click the terminal icon beside an available version to fill `go get module@version` in the correct module terminal without executing it.

Inlay hints are purely visual overlays rendered by VS Code and never modify the document content.

## Deprecated and retracted modules

ModBear parses deprecation and retraction metadata published by upstream module authors:

- **Deprecation Diagnostics**: Highlights deprecated modules with actionable informational or warning diagnostics in the VS Code Problems pane.
- **Retraction Diagnostics**: Flags retracted versions to prevent accidental usage of compromised or broken releases.

## Vulnerability scanning

ModBear integrates `govulncheck` to scan your Go project dependencies for vulnerabilities:

- **Reachable vulnerabilities** are flagged as error diagnostics in the VS Code Problems pane.
- **Imported and module-only vulnerabilities** are surfaced as warning diagnostics.
- **Unavailable state**: If `govulncheck` is not installed or cannot execute, ModBear shows `Vulnerability analysis unavailable` rather than assuming your project is clean.

## Module health analysis

ModBear adds two read-only health phases to each scan:

- **Tidy consistency**: For save-triggered and manual scans, ModBear runs `go mod tidy -diff` and shows a warning on the module directive when dependencies are not tidy (`tidy-diff`). The diff can be viewed read-only via **ModBear: Show Tidy Diff** and is never applied; open/background scans skip this phase.
- **Toolchain compatibility**: ModBear compares your installed Go version (`go env GOVERSION`) with the `go` and `toolchain` directives and reports incompatible or malformed versions on the corresponding directives.

**ModBear: Explain Dependency** runs `go mod why -m` for a selected module and renders the explanation in a read-only document. Commands shown anywhere in ModBear are suggestions only and are never executed automatically.

## Supported Go/VS Code versions

- **VS Code**: `^1.125.0` or newer.
- **Go Toolchain**: Go 1.21 or newer (requires `go list -u -m -json all` support).

## Workspace Trust

ModBear respects VS Code Workspace Trust boundaries:

- In **Untrusted Workspaces**, ModBear runs in Restricted Mode: external subprocess execution (`go list` and `govulncheck`) is completely disabled to protect your system from executing arbitrary code or tools in untrusted repositories.
- Go executable paths (`modBear.go.path` and `modBear.govulncheck.path`) are restricted and can only be set in trusted user or workspace scopes.

## Private modules and network access

ModBear relies exclusively on your standard local Go environment (`GOPRIVATE`, `GOPROXY`, `GONOPROXY`, git credentials, `.netrc`).

- ModBear does **not** make direct HTTP network requests or bypass standard Go proxy rules.
- `go list -u -m -json all` is invoked via your local `go` binary, maintaining your existing proxy, mirror, and private registry authentication configurations.

## Privacy and Local Logging

- **No Telemetry**: ModBear is completely telemetry-free. It does not collect, report, or transmit any data, analytics, or crash reports to external servers.
- **Local Logging**: Extension activity is recorded locally and written only to the VS Code Output Channel ("ModBear").
- **Configurable Verbosity**: Logging is controlled by the `modBear.output.logLevel` setting, allowing you to filter or disable output as needed.
- **Data Redaction**: Log events redact sensitive information (such as user home directory paths, passwords, and private proxy headers) before writing to the output channel.

## Commands

ModBear contributes the following commands (accessible via the Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command ID                  | Title                                | Description                                                                                        |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `modBear.scanWorkspace`     | ModBear: Scan Workspace              | Manually triggers a scan across all Go modules in the workspace.                                   |
| `modBear.scanModule`        | ModBear: Scan Current Module         | Triggers a scan for the module containing the active document.                                     |
| `modBear.showDetails`       | ModBear: Show Dependency Details     | Opens a read-only document with details for the selected dependency.                               |
| `modBear.explainDependency` | ModBear: Explain Dependency          | Runs `go mod why -m` for a selected dependency and opens the explanation in a read-only document.  |
| `modBear.openAdvisory`      | ModBear: Open Vulnerability Advisory | Opens a vulnerability advisory from the latest scan after validating it is a credential-free link. |
| `modBear.showTidyDiff`      | ModBear: Show Tidy Diff              | Shows the read-only `go mod tidy -diff` output when the active module is not tidy.                 |
| `modBear.copySuggestion`    | ModBear: Copy Suggested Command      | Copies the suggested update command (e.g. `go get ...`) to clipboard.                              |
| `modBear.showStatusBarMenu` | ModBear: Show Status Bar Menu        | Opens the ModBear menu to scan the workspace, open modules, or view logs.                          |
| `modBear.showOutput`        | ModBear: Show Output                 | Opens the ModBear output channel to inspect logs.                                                  |

## Settings

ModBear can be configured using VS Code settings (`settings.json`):

| Setting Key                                         | Type      | Default         | Description                                                                                                    |
| --------------------------------------------------- | --------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `modBear.enabled`                                   | `boolean` | `true`          | Enables or disables ModBear.                                                                                   |
| `modBear.go.path`                                   | `string`  | `"go"`          | Path to the `go` executable (Restricted in Untrusted Workspaces).                                              |
| `modBear.govulncheck.path`                          | `string`  | `"govulncheck"` | Path to the `govulncheck` executable (Restricted in Untrusted Workspaces).                                     |
| `modBear.scan.onOpen`                               | `boolean` | `true`          | Automatically trigger scan when opening `go.mod`.                                                              |
| `modBear.scan.onSave`                               | `boolean` | `true`          | Automatically trigger scan when saving `go.mod`.                                                               |
| `modBear.scan.updateTtlMinutes`                     | `number`  | `30`            | Minutes to cache analysis snapshots before re-scanning.                                                        |
| `modBear.scan.tidyTtlMinutes`                       | `number`  | `10`            | Minutes to cache tidy analysis results before re-running `go mod tidy -diff`.                                  |
| `modBear.scan.vulnerabilityTtlMinutes`              | `number`  | `360`           | Minutes to cache vulnerability results before re-running `govulncheck`.                                        |
| `modBear.tidy.enabled`                              | `boolean` | `true`          | Enables read-only tidy analysis on save-triggered and manual scans.                                            |
| `modBear.scan.maxConcurrentModules`                 | `number`  | `2`             | Maximum concurrent background module scans.                                                                    |
| `modBear.scan.timeoutSeconds`                       | `number`  | `120`           | Timeout in seconds for individual module scan subprocesses.                                                    |
| `modBear.vulnerability.enabled`                     | `boolean` | `true`          | Enables vulnerability scanning.                                                                                |
| `modBear.vulnerability.timeoutSeconds`              | `number`  | `600`           | Timeout in seconds for `govulncheck` runs.                                                                     |
| `modBear.vulnerability.includeTests`                | `boolean` | `false`         | Reserved for including test files in vulnerability scans; currently only participates in the scan cache key.   |
| `modBear.vulnerability.buildTags`                   | `array`   | `[]`            | Reserved Go build tags for vulnerability scans; currently only participates in the scan cache key.             |
| `modBear.vulnerability.database`                    | `string`  | `""`            | Reserved custom vulnerability database URL (window-scoped); currently only participates in the scan cache key. |
| `modBear.inlayHints.enabled`                        | `boolean` | `true`          | Enables inline inlay version hints in `go.mod`.                                                                |
| `modBear.inlayHints.showIndirect`                   | `boolean` | `true`          | Displays inlay hints for indirect dependencies (`// indirect`).                                                |
| `modBear.inlayHints.showUpToDate`                   | `boolean` | `false`         | Displays `✓ current` for up-to-date dependencies.                                                              |
| `modBear.inlayHints.showUpdateKind`                 | `boolean` | `true`          | Shows update classification (`patch`, `minor`, `major`).                                                       |
| `modBear.diagnostics.updateSeverity`                | `string`  | `"none"`        | Severity level for update diagnostics (`none`, `information`, `warning`).                                      |
| `modBear.diagnostics.importedVulnerabilitySeverity` | `string`  | `"warning"`     | Severity level for imported/module-only vulnerability diagnostics (`none`, `information`, `warning`, `error`). |
| `modBear.output.logLevel`                           | `string`  | `"info"`        | Log level for the output channel (`error`, `warn`, `info`, `debug`).                                           |

## Known overlap with the official Go extension

ModBear is designed to complement the official [VS Code Go extension (`golang.go`)](https://marketplace.visualstudio.com/items?itemName=golang.Go):

- **Language Server vs. Dependency Health**: The official Go extension uses `gopls` for autocompletion, code navigation, refactoring, and formatting. ModBear focuses specifically on deep module health, inline `go.mod` version hints, deprecation notice extraction, and retraction monitoring.
- **No Conflict**: ModBear does not provide a language server, run `gopls`, or format code. It works side-by-side with `vscode-go` without interference.
