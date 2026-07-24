# Terminal Update Button Design

## Goal

Add an explicit terminal icon beside each available-version inlay hint. Clicking the icon opens or focuses a VS Code integrated terminal rooted at the dependency's Go module and fills in the matching `go get` command without executing it.

Example:

```text
github.com/gin-gonic/gin v1.9.1  [terminal icon] → v1.10.1 · minor
```

The terminal receives:

```sh
go get github.com/gin-gonic/gin@v1.10.1
```

The user must press Enter to run the command.

## User Experience

- The terminal icon uses VS Code's `terminal` codicon so it matches the editor UI.
- Only the icon is clickable. The existing version and update-kind text remains informational.
- The icon appears only when `availableVersion` is present.
- The icon tooltip explains that clicking it prepares the suggested command in the terminal.
- Clicking the icon opens or focuses a ModBear terminal whose working directory is the owning module's `moduleRoot`.
- The extension writes the suggestion with `sendText(command, false)`. The `false` value is mandatory because it prevents VS Code from appending a newline and executing the command.
- Repeated actions may reuse a live ModBear terminal for the same module. A disposed terminal is removed from the reuse registry.

## Architecture

### Inlay hint

`DependencyInlayHintsProvider` will represent update hints with `InlayHintLabelPart` values:

1. a terminal-icon label part carrying the command;
2. the existing available-version label part, with no command.

The command arguments contain only structured values needed by the handler: the module context, dependency module path, and available version. The inlay provider does not create terminals itself.

### Command handler

A new internal command, registered during extension activation, owns terminal interaction. It will:

1. require a trusted workspace;
2. validate the structured command arguments;
3. format the `go get <module>@<version>` suggestion without line breaks or terminal control characters;
4. obtain or create a terminal rooted at `moduleRoot`;
5. show the terminal;
6. call `sendText(command, false)`.

Terminal lifecycle tracking will be isolated in a small provider/service so command formatting and terminal reuse can be tested independently from extension activation.

### Command formatting

Normal Go module paths and semantic versions produce the familiar unquoted command. Values containing shell-significant characters, carriage returns, line feeds, or terminal control characters are rejected rather than inserted into a terminal.

## Safety and Trust

- Clicking the icon never invokes `go get` through a subprocess, task, or shell API.
- No newline is sent to the terminal, so the extension does not execute the prepared command.
- The action is unavailable in untrusted workspaces and also checks trust again inside its command handler.
- The terminal starts in the exact module root supplied by module discovery, ensuring the command targets the correct `go.mod`.
- Existing read-only scans and file handling remain unchanged.
- Documentation will distinguish between preparing a command and executing it: ModBear may now place a suggestion in the terminal, but still never runs it automatically.

## Error Handling

- Invalid or unsafe command data produces a visible error and does not create or write to a terminal.
- If the module root is unavailable, the command reports the failure rather than falling back to an unrelated working directory.
- Terminal creation or interaction failures are logged and shown to the user without changing workspace files.

## Testing

Tests will verify:

- an update hint contains a clickable terminal icon and the informational version text;
- dependencies without an available version do not receive the terminal action;
- the suggested command uses the dependency path and exact available version;
- the terminal is rooted at the owning module;
- `sendText` is called with `false`;
- invalid values containing newlines or control characters are rejected;
- untrusted workspaces do not receive terminal input;
- existing inlay-hint and hover behavior remains intact.

## Out of Scope

- Automatically executing `go get`;
- modifying `go.mod` or `go.sum` directly;
- running `go mod tidy`;
- adding a global "update all" action;
- changing update discovery or version selection.
