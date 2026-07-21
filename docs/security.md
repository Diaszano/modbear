# ModBear Security & Safety Invariants

This document details the security architecture, safety guarantees, and invariants enforced throughout the ModBear extension.

## 1. Forbidden Commands & Read-Only Guarantee

ModBear enforces a strict read-only model. The extension **never** mutates module manifests (`go.mod`, `go.sum`, `go.work`) or alters the local Go environment.

### Forbidden Operations Matrix
- **`go get`**: Strictly forbidden from being spawned or executed by the extension. Suggested update commands are displayed in hover cards or copied to clipboard only.
- **`go mod tidy`**: Forbidden in mutating form. (In future plans, only the safe read-only form `go mod tidy -diff` may be used).
- **`go env -w`**: Strictly forbidden; ModBear never mutates environment configuration.
- **`go install`**: Strictly forbidden from being invoked by the extension.
- **`shell: true`**: Strictly forbidden in subprocess options. All execution must bypass the system command shell.

### Enforcement
- Subprocess invocations pass `GOFLAGS=-mod=readonly` to guarantee the Go toolchain will fail if any operation attempts file modification.
- Automated repository verification checks run:
  ```bash
  ! grep -R -nE 'go get|go mod tidy([^[:alnum:]-]|$)|go env -w|go install|shell:[[:space:]]*true' src --exclude-dir=test
  ```

## 2. Shell-Free Execution

All external tool invocations are executed via Node.js `child_process.execFile` (or equivalent APIs) without invoking a command interpreter (`sh`, `bash`, `cmd.exe`, or `powershell`).

- **No Shell Interpolation**: Commands are called directly by binary path.
- **Argument Arrays**: Arguments are passed strictly as string arrays (e.g. `["list", "-u", "-m", "-json", "all"]`).
- **No Concatenated Command Strings**: Command line construction via string concatenation is strictly prohibited to prevent argument injection attacks.

## 3. Redaction Rules

Log outputs (sent to VS Code Output Channels or diagnostic logs) are sanitized to prevent credential leaks or sensitive system exposure.

- **URL Credentials**: URLs containing basic authentication credentials (e.g. `https://user:password@proxy.example.com`) are sanitized via `redactUrlCredentials` to mask secret tokens and passwords.
- **Environment & Path Redaction**: Command lines and environment values displayed in logs redact user home directory paths, auth tokens, and private proxy headers via `redactCommand`.

## 4. Workspace Trust Behavior

ModBear strictly adheres to VS Code Workspace Trust specifications:

- **Restricted Mode in Untrusted Workspaces**: If a workspace is untrusted (`vscode.workspace.isTrusted === false`), all subprocess execution is completely disabled.
- **No Background Operations**: In untrusted workspaces, background scans, auto-discovery, and toolchain invocations are prevented.
- **Restricted Configuration Settings**: Executable path configurations (`modBear.go.path`, `modBear.govulncheck.path`, `modBear.vulnerability.database`) are marked with `"scope": "window"` and restricted capabilities so untrusted workspaces cannot redirect execution to malicious binaries.

## 5. Test-Fixture Hash Invariant

To ensure testing integrity and guarantee that extension tests do not cause disk side-effects:

- **Fixture Hash Invariant**: Test fixtures under `src/test/fixtures/` must remain bit-for-bit identical before and after test execution.
- Integration tests verify SHA-256 checksums of `go.mod`, `go.sum`, and `go.work` fixture files to confirm zero on-disk mutations occur during scanner runs or test suite execution.
