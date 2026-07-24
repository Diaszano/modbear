# ModBear Security & Safety Invariants

This document details the security architecture, safety guarantees, and invariants enforced throughout the ModBear extension.

## 1. Forbidden Commands & Read-Only Guarantee

ModBear enforces a strict read-only model. The extension **never** mutates module manifests (`go.mod`, `go.sum`, `go.work`) or alters the local Go environment.

### Forbidden Operations Matrix
- **`go get`**: Strictly forbidden from being spawned or automatically executed by the extension. A suggestion may be displayed, copied, or inserted into a trusted-workspace terminal with `sendText(command, false)` so the user must press Enter.
- **`go mod tidy`**: Forbidden in mutating form. (In future plans, only the safe read-only form `go mod tidy -diff` may be used).
- **`go env -w`**: Strictly forbidden; ModBear never mutates environment configuration.
- **`go install`**: Strictly forbidden from being invoked by the extension.
- **`shell: true`**: Strictly forbidden in subprocess options. All execution must bypass the system command shell.

### Enforcement
- Subprocess invocations pass `GOFLAGS=-mod=readonly` to guarantee the Go toolchain will fail if any operation attempts file modification.
- Automated repository verification checks run:
  ```bash
  ! grep -R -nE 'shell:[[:space:]]*true' src --include='*.ts' --exclude-dir=test
  ! grep -R -nE 'go get|"go",[[:space:]]*"get"|go mod tidy([^[:alnum:]-]|$)|go env -w|go install' src --include='*.ts' --exclude-dir=test | grep -vF 'return ["go", "get", `${args.modulePath}@${args.version}`].join(" ");' | grep -vF 'markdown.appendCodeblock(`${["go", "get"].join(" ")} ${status.modulePath}@${status.availableVersion}`, "shell");' | grep -vF 'terminalPart.tooltip = "Prepare the suggested go get command in the terminal";'
  test "$(grep -R -oE '\.sendText[[:space:]]*\(' src --include='*.ts' --exclude-dir=test | wc -l)" -eq 1
  grep -nF 'terminal.sendText(buildGoGetSuggestion(args), false);' src/providers/terminalUpdateManager.ts
  ```
- The three exact `go get` exclusions are inert suggestion construction, hover display, and tooltip text; any other production occurrence fails verification.
- Production has exactly one terminal write, and the positive check requires its non-executing `false` argument. Omitting the second argument, passing `true`, or adding another production `sendText` call fails verification.
- Terminal suggestions accept only validated Go module paths and versions without shell metacharacters or control characters.
- Tests require every terminal suggestion to call `sendText(command, false)`.
- Terminal preparation is blocked when VS Code reports an untrusted workspace.

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

- **Restricted Mode in Untrusted Workspaces**: If a workspace is untrusted (`vscode.workspace.isTrusted === false`), all subprocess execution (including `go` and `govulncheck`) is completely disabled.
- **No Background Operations**: In untrusted workspaces, background scans, auto-discovery, and toolchain invocations are prevented.
- **Restricted Configuration Settings**: The Go and govulncheck executable path configurations (`modBear.go.path`, `modBear.govulncheck.path`) are marked with `"scope": "window"` and restricted capabilities so untrusted workspaces cannot redirect execution to malicious binaries.
- **Vulnerability Advisory Safety**: All vulnerability advisory text displayed in hover cards is escaped using the Markdown escaping function, and the hover webview forces `MarkdownString.isTrusted = false` to mitigate command injection risks.

## 5. Test-Fixture Hash Invariant

To ensure testing integrity and guarantee that extension tests do not cause disk side-effects:

- **Fixture Hash Invariant**: Test fixtures under `src/test/fixtures/` must remain bit-for-bit identical before and after test execution.
- Integration tests verify SHA-256 checksums of `go.mod`, `go.sum`, and `go.work` fixture files to confirm zero on-disk mutations occur during scanner runs or test suite execution.
