# Terminal Update Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clickable terminal icon beside available dependency versions that prepares, but does not execute, the exact `go get` suggestion in a terminal rooted at the owning Go module.

**Architecture:** A pure terminal-update manager validates command data, formats the suggestion, and owns one reusable terminal per module root through an injected terminal factory. The inlay provider emits a composite label whose terminal icon invokes an internal command; extension activation registers the trusted command handler and terminal-close cleanup.

**Tech Stack:** TypeScript 5.7, VS Code Extension API 1.109, Node.js test runner, Mocha VS Code extension tests.

## Global Constraints

- The terminal icon uses VS Code's `terminal` codicon.
- Only the icon is clickable; the version and update-kind text remain informational.
- The icon appears only when `availableVersion` is present and the workspace is trusted.
- The terminal working directory is the owning module's exact `moduleRoot`.
- Terminal input must use `sendText(command, false)`; the extension never appends Enter or executes `go get`.
- Module paths and versions containing shell metacharacters, line breaks, or terminal control characters are rejected.
- Existing scans remain read-only and no code edits `go.mod`, `go.sum`, or `go.work`.

---

## File Structure

- Create `src/providers/terminalUpdateManager.ts`: command ID, argument validation, safe suggestion formatting, terminal creation/reuse, and terminal-close cleanup.
- Create `src/test/unit/terminalUpdateManager.test.ts`: plain Node tests for validation, formatting, working directory, non-execution, reuse, and cleanup.
- Modify `src/providers/dependencyInlayHintsProvider.ts`: composite inlay label with a clickable terminal-icon part.
- Modify `src/test/suite/inlayHints.test.ts`: VS Code API assertions for the icon, command arguments, and non-update behavior.
- Modify `src/extension.ts`: trusted command registration and terminal lifecycle wiring.
- Create `src/test/suite/terminalUpdateCommand.test.ts`: command-level tests for trust, working directory, and `sendText(..., false)`.
- Modify `README.md`: describe terminal preparation without claiming the suggestion is display/clipboard-only.
- Modify `docs/security.md`: preserve the no-automatic-execution invariant while documenting terminal preparation.

### Task 1: Safe Terminal Update Manager

**Files:**

- Create: `src/providers/terminalUpdateManager.ts`
- Test: `src/test/unit/terminalUpdateManager.test.ts`

**Interfaces:**

- Consumes: an injected `TerminalFactory(options: TerminalCreationOptions): TerminalHandle`.
- Produces: `PREPARE_UPDATE_COMMAND_ID`, `PrepareUpdateArgs`, `buildGoGetSuggestion(input)`, and `TerminalUpdateManager.prepare(input)` / `forget(terminal)`.

- [ ] **Step 1: Write the failing manager tests**

Create `src/test/unit/terminalUpdateManager.test.ts`:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildGoGetSuggestion,
  TerminalUpdateManager,
  type TerminalCreationOptions,
  type TerminalHandle,
} from "../../providers/terminalUpdateManager";

class FakeTerminal implements TerminalHandle {
  public readonly sent: Array<{ text: string; shouldExecute: boolean | undefined }> = [];
  public showCalls = 0;

  public show(): void {
    this.showCalls += 1;
  }

  public sendText(text: string, shouldExecute?: boolean): void {
    this.sent.push({ text, shouldExecute });
  }
}

const validInput = {
  moduleRoot: path.resolve("/workspace/app"),
  modulePath: "github.com/gin-gonic/gin",
  version: "v1.10.1",
};

test("builds the exact go get suggestion", () => {
  assert.equal(buildGoGetSuggestion(validInput), "go get github.com/gin-gonic/gin@v1.10.1");
});

test("rejects unsafe module paths and versions", () => {
  assert.throws(() => buildGoGetSuggestion({ ...validInput, modulePath: "example.com/mod;echo" }), /module path/);
  assert.throws(() => buildGoGetSuggestion({ ...validInput, version: "v1.2.3\nwhoami" }), /version/);
});

test("creates a module-rooted terminal and fills without executing", () => {
  const created: TerminalCreationOptions[] = [];
  const terminal = new FakeTerminal();
  const manager = new TerminalUpdateManager((options) => {
    created.push(options);
    return terminal;
  });

  manager.prepare(validInput);

  assert.deepEqual(created, [{ name: "ModBear", cwd: validInput.moduleRoot }]);
  assert.equal(terminal.showCalls, 1);
  assert.deepEqual(terminal.sent, [
    {
      text: "go get github.com/gin-gonic/gin@v1.10.1",
      shouldExecute: false,
    },
  ]);
});

test("reuses a live terminal for the same module root", () => {
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(validInput);
  manager.prepare({ ...validInput, version: "v1.11.0" });

  assert.equal(creations, 1);
  assert.equal(terminals[0]!.sent.length, 2);
});

test("forgets a closed terminal before the next preparation", () => {
  const terminals = [new FakeTerminal(), new FakeTerminal()];
  let creations = 0;
  const manager = new TerminalUpdateManager(() => terminals[creations++]!);

  manager.prepare(validInput);
  manager.forget(terminals[0]!);
  manager.prepare(validInput);

  assert.equal(creations, 2);
  assert.equal(terminals[1]!.sent.length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm run compile
```

Expected: FAIL with `TS2307` because `../../providers/terminalUpdateManager` does not exist.

- [ ] **Step 3: Implement the terminal update manager**

Create `src/providers/terminalUpdateManager.ts`:

```ts
import path from "node:path";

export const PREPARE_UPDATE_COMMAND_ID = "modBear.prepareUpdateInTerminal";

export interface PrepareUpdateArgs {
  readonly moduleRoot: string;
  readonly modulePath: string;
  readonly version: string;
}

export interface TerminalCreationOptions {
  readonly name: string;
  readonly cwd: string;
}

export interface TerminalHandle {
  show(preserveFocus?: boolean): void;
  sendText(text: string, shouldExecute?: boolean): void;
}

export type TerminalFactory = (options: TerminalCreationOptions) => TerminalHandle;

const SAFE_MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~+/-]*$/;
const SAFE_VERSION = /^v[0-9][A-Za-z0-9.+-]*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function parsePrepareUpdateArgs(input: unknown): PrepareUpdateArgs {
  if (!isRecord(input)) throw new Error("Invalid terminal update arguments.");
  const { moduleRoot, modulePath, version } = input;
  if (typeof moduleRoot !== "string" || !path.isAbsolute(moduleRoot) || CONTROL_CHARACTERS.test(moduleRoot)) {
    throw new Error("Invalid module root.");
  }
  if (typeof modulePath !== "string" || !SAFE_MODULE_PATH.test(modulePath)) {
    throw new Error("Invalid module path.");
  }
  if (typeof version !== "string" || !SAFE_VERSION.test(version)) {
    throw new Error("Invalid version.");
  }
  return { moduleRoot, modulePath, version };
}

export function buildGoGetSuggestion(input: unknown): string {
  const args = parsePrepareUpdateArgs(input);
  return ["go", "get", `${args.modulePath}@${args.version}`].join(" ");
}

export class TerminalUpdateManager {
  private readonly terminalsByRoot = new Map<string, TerminalHandle>();

  public constructor(private readonly createTerminal: TerminalFactory) {}

  public prepare(input: unknown): void {
    const args = parsePrepareUpdateArgs(input);
    let terminal = this.terminalsByRoot.get(args.moduleRoot);
    if (!terminal) {
      terminal = this.createTerminal({ name: "ModBear", cwd: args.moduleRoot });
      this.terminalsByRoot.set(args.moduleRoot, terminal);
    }
    terminal.show();
    terminal.sendText(buildGoGetSuggestion(args), false);
  }

  public forget(terminal: TerminalHandle): void {
    for (const [moduleRoot, candidate] of this.terminalsByRoot) {
      if (candidate === terminal) this.terminalsByRoot.delete(moduleRoot);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Run the focused unit tests**

Run:

```bash
npm run compile && node --test out/test/unit/terminalUpdateManager.test.js
```

Expected: 5 tests pass and `sendText` is observed with `shouldExecute: false`.

- [ ] **Step 5: Commit the manager**

```bash
git add src/providers/terminalUpdateManager.ts src/test/unit/terminalUpdateManager.test.ts
git commit -m "feat: add safe terminal update manager"
```

### Task 2: Clickable Terminal Icon Inlay

**Files:**

- Modify: `src/providers/dependencyInlayHintsProvider.ts:1-58`
- Modify: `src/test/suite/inlayHints.test.ts:1-96`

**Interfaces:**

- Consumes: `PREPARE_UPDATE_COMMAND_ID` and `PrepareUpdateArgs` from Task 1.
- Produces: an `InlayHintLabelPart[]` where the `$(terminal)` part alone carries the command.

- [ ] **Step 1: Update the extension test to require the clickable icon**

In the first test in `src/test/suite/inlayHints.test.ts`, replace the label assertions after `assert.equal(hints[0]?.position.character, ...)` with:

```ts
const label = hints[0]?.label;
assert.ok(Array.isArray(label));
assert.equal(label[0]?.value, "$(terminal)");
assert.equal(label[0]?.command?.command, "modBear.prepareUpdateInTerminal");
assert.deepEqual(label[0]?.command?.arguments, [
  {
    moduleRoot: module.moduleRoot,
    modulePath: "github.com/gin-gonic/gin",
    version: "v1.10.1",
  },
]);
assert.equal(label[1]?.value, " → v1.10.1 · minor");
assert.equal(label[1]?.command, undefined);
assert.equal(document.getText().includes("v1.10.1"), false);
```

Add this test before the hover test:

```ts
test("does not add the terminal action without an available version", async () => {
  const document = await vscode.workspace.openTextDocument({
    language: "go.mod",
    content: "module example.com/app\n\nrequire example.com/old v1.0.0\n",
  });
  const module: ModuleContext = {
    id: "/workspace/app",
    moduleRoot: "/workspace/app",
    goModPath: document.uri.fsPath,
  };
  const snapshot: ModuleAnalysisSnapshot = {
    moduleId: module.id,
    contentHash: "fixture",
    createdAt: new Date(0).toISOString(),
    stale: false,
    updateState: "complete",
    dependencies: [
      {
        modulePath: "example.com/old",
        installedVersion: "v1.0.0",
        deprecatedMessage: "use example.com/new",
        retractionRationales: [],
        errors: [],
      },
    ],
    replacements: [],
    errors: [],
  };
  const coordinator = { getSnapshot: () => snapshot } as Pick<ScanCoordinator, "getSnapshot"> as ScanCoordinator;
  const provider = new DependencyInlayHintsProvider(
    coordinator,
    () => module,
    () => undefined,
  );

  const hints = provider.provideInlayHints(document);

  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.label, "⚠ deprecated");
  provider.dispose();
});
```

- [ ] **Step 2: Run the extension test to verify it fails**

Run:

```bash
npm run compile && npm run bundle && npm run test:extension:run
```

Expected: FAIL because the update hint label is still a string and has no terminal command.

- [ ] **Step 3: Build the composite inlay label**

Add this import to `src/providers/dependencyInlayHintsProvider.ts`:

```ts
import { PREPARE_UPDATE_COMMAND_ID, type PrepareUpdateArgs } from "./terminalUpdateManager";
```

Replace the `vscode.InlayHint` construction block with:

```ts
let hintLabel: string | vscode.InlayHintLabelPart[] = finalLabel;
if (status?.availableVersion && vscode.workspace.isTrusted) {
  const actionArgs: PrepareUpdateArgs = {
    moduleRoot: module.moduleRoot,
    modulePath: requirement.modulePath,
    version: status.availableVersion,
  };
  const terminalPart = new vscode.InlayHintLabelPart("$(terminal)");
  terminalPart.tooltip = "Prepare the suggested go get command in the terminal";
  terminalPart.command = {
    command: PREPARE_UPDATE_COMMAND_ID,
    title: "Prepare Update in Terminal",
    arguments: [actionArgs],
  };
  const informationPart = new vscode.InlayHintLabelPart(` ${finalLabel}`);
  hintLabel = [terminalPart, informationPart];
}
const hint = new vscode.InlayHint(
  new vscode.Position(requirement.versionRange.end.line, requirement.versionRange.end.character),
  hintLabel,
  vscode.InlayHintKind.Type,
);
hint.paddingLeft = true;
hint.tooltip = new vscode.MarkdownString(
  `**${requirement.modulePath}**\n\nInstalled: \`${requirement.version}\`\n\n${finalLabel}`,
);
return [hint];
```

- [ ] **Step 4: Run provider and unit regression tests**

Run:

```bash
npm run compile && node --test out/test/unit/inlayLabel.test.js && npm run bundle && npm run test:extension:run
```

Expected: unit label tests pass and all VS Code extension tests pass, including the composite label assertions.

- [ ] **Step 5: Commit the clickable icon**

```bash
git add src/providers/dependencyInlayHintsProvider.ts src/test/suite/inlayHints.test.ts
git commit -m "feat: add terminal action to update hints"
```

### Task 3: Trusted Command Wiring and Documentation

**Files:**

- Modify: `src/extension.ts:1-215`
- Create: `src/test/suite/terminalUpdateCommand.test.ts`
- Modify: `README.md:9-23`
- Modify: `docs/security.md:5-29`

**Interfaces:**

- Consumes: `PREPARE_UPDATE_COMMAND_ID` and `TerminalUpdateManager` from Task 1; command arguments emitted by Task 2.
- Produces: a registered internal command that checks Workspace Trust before any terminal interaction and releases closed terminals from the manager.

- [ ] **Step 1: Write failing command integration tests**

Create `src/test/suite/terminalUpdateCommand.test.ts`:

```ts
import assert from "node:assert/strict";
import * as vscode from "vscode";

suite("Terminal update command", () => {
  test("fills a module-rooted terminal without executing", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    assert.ok(extension);
    if (!extension.isActive) await extension.activate();

    const originalCreateTerminal = vscode.window.createTerminal;
    const sent: Array<{ text: string; shouldExecute: boolean | undefined }> = [];
    let receivedOptions: vscode.TerminalOptions | undefined;
    const fakeTerminal = {
      show: () => undefined,
      sendText: (text: string, shouldExecute?: boolean) => {
        sent.push({ text, shouldExecute });
      },
    } as vscode.Terminal;
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: (options: vscode.TerminalOptions) => {
        receivedOptions = options;
        return fakeTerminal;
      },
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot: "/workspace/terminal-command-test",
        modulePath: "github.com/gin-gonic/gin",
        version: "v1.10.1",
      });

      assert.equal(receivedOptions?.name, "ModBear");
      assert.equal(receivedOptions?.cwd, "/workspace/terminal-command-test");
      assert.deepEqual(sent, [
        {
          text: "go get github.com/gin-gonic/gin@v1.10.1",
          shouldExecute: false,
        },
      ]);
    } finally {
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal,
      });
    }
  });

  test("does not create or fill a terminal in an untrusted workspace", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    assert.ok(extension);
    if (!extension.isActive) await extension.activate();

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalCreateTerminal = vscode.window.createTerminal;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    let terminalCreated = false;
    Object.defineProperty(vscode.workspace, "isTrusted", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: () => {
        terminalCreated = true;
        throw new Error("terminal must not be created");
      },
    });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      configurable: true,
      value: async () => undefined,
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot: "/workspace/untrusted-terminal-test",
        modulePath: "example.com/mod",
        version: "v1.2.3",
      });

      assert.equal(terminalCreated, false);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        configurable: true,
        get: () => originalIsTrusted,
      });
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal,
      });
      Object.defineProperty(vscode.window, "showWarningMessage", {
        configurable: true,
        value: originalShowWarningMessage,
      });
    }
  });
});
```

- [ ] **Step 2: Run the command tests to verify they fail**

Run:

```bash
npm run compile && npm run bundle && npm run test:extension:run
```

Expected: FAIL because `modBear.prepareUpdateInTerminal` is not registered.

- [ ] **Step 3: Register the trusted command and terminal cleanup**

Add this import to `src/extension.ts`:

```ts
import { PREPARE_UPDATE_COMMAND_ID, TerminalUpdateManager } from "./providers/terminalUpdateManager";
```

After `const statusBarManager = new StatusBarManager(coordinator);`, add:

```ts
const terminalUpdateManager = new TerminalUpdateManager((options) => vscode.window.createTerminal(options));
```

Add this subscription to the first `context.subscriptions.push(...)` call:

```ts
    vscode.window.onDidCloseTerminal((terminal) => terminalUpdateManager.forget(terminal)),
```

Add this registration at the start of the command registration block:

```ts
    vscode.commands.registerCommand(PREPARE_UPDATE_COMMAND_ID, async (input: unknown) => {
      if (!(await requireTrustedWorkspace())) return;
      try {
        terminalUpdateManager.prepare(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.error(`Could not prepare dependency update: ${message}`);
        await vscode.window.showErrorMessage(`ModBear: Could not prepare update: ${message}`);
      }
    }),
```

Change the untrusted-workspace warning in `requireTrustedWorkspace` to:

```ts
await vscode.window.showWarningMessage("Trust this workspace before running ModBear workspace actions.");
```

- [ ] **Step 4: Run the command integration tests**

Run:

```bash
npm run compile && npm run bundle && npm run test:extension:run
```

Expected: all extension tests pass; the trusted command records `shouldExecute: false`, and the untrusted command never calls `createTerminal`.

- [ ] **Step 5: Update the user and security documentation**

In `README.md`, replace the read-only guarantee paragraphs with:

```md
## Read-only guarantee

> ModBear never runs `go get` automatically and never edits `go.mod`, `go.sum`, or `go.work` itself.

ModBear is safe and non-intrusive. Update suggestions can be displayed, copied, or prepared in an integrated terminal rooted at the owning module. A prepared command is inserted without Enter; only the user can choose to execute it.
```

Add this bullet beneath the inline available-version hint list:

```md
- **Terminal preparation**: Click the terminal icon beside an available version to fill `go get module@version` in the correct module terminal without executing it.
```

In `docs/security.md`, replace the `go get` matrix entry with:

```md
- **`go get`**: Strictly forbidden from being spawned or automatically executed by the extension. A suggestion may be displayed, copied, or inserted into a trusted-workspace terminal with `sendText(command, false)` so the user must press Enter.
```

Add these enforcement bullets after the existing repository verification command:

```md
- Terminal suggestions accept only validated Go module paths and versions without shell metacharacters or control characters.
- Tests require every terminal suggestion to call `sendText(command, false)`.
- Terminal preparation is blocked when VS Code reports an untrusted workspace.
```

- [ ] **Step 6: Run complete verification**

Run:

```bash
npm run verify
npm run bundle
npm run test:extension:run
git diff --check
```

Expected: TypeScript compilation succeeds, all unit and integration tests pass, all VS Code extension tests pass, the bundle builds, and `git diff --check` prints no errors.

- [ ] **Step 7: Verify the no-automatic-execution invariant directly**

Run:

```bash
rg -n "sendText\\(" src --glob "*.ts"
rg -n "executeCommand\\(|execFile\\(|spawn\\(" src/providers/terminalUpdateManager.ts src/extension.ts
```

Expected:

- The terminal update manager contains exactly one `sendText` call and it passes `false`.
- Test fakes may record `sendText`, but production code has no other terminal update call.
- No terminal update path uses shell integration execution, `execFile`, or `spawn`.

- [ ] **Step 8: Commit command wiring and documentation**

```bash
git add src/extension.ts src/test/suite/terminalUpdateCommand.test.ts README.md docs/security.md
git commit -m "feat: prepare dependency updates in terminal"
```
