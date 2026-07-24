import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";

suite("Terminal update command", () => {
  test("fills a module-rooted terminal without executing", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    assert.ok(extension);
    if (!extension.isActive) await extension.activate();

    const originalCreateTerminal = vscode.window.createTerminal;
    const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-terminal-command-"));
    await writeFile(path.join(moduleRoot, "go.mod"), "module example.com/test\n");
    const sent: Array<{ text: string; shouldExecute: boolean | undefined }> = [];
    let receivedOptions: vscode.TerminalOptions | undefined;
    const fakeTerminal = {
      show: () => undefined,
      sendText: (text: string, shouldExecute?: boolean) => {
        sent.push({ text, shouldExecute });
      }
    } as vscode.Terminal;
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: (options: vscode.TerminalOptions) => {
        receivedOptions = options;
        return fakeTerminal;
      }
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot,
        modulePath: "github.com/gin-gonic/gin",
        version: "v1.10.1"
      });

      assert.equal(receivedOptions?.name, "ModBear");
      assert.equal(receivedOptions?.cwd, moduleRoot);
      assert.deepEqual(sent, [{
        text: "go get github.com/gin-gonic/gin@v1.10.1",
        shouldExecute: false
      }]);
    } finally {
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal
      });
      await rm(moduleRoot, { recursive: true, force: true });
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
      get: () => false
    });
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: () => {
        terminalCreated = true;
        throw new Error("terminal must not be created");
      }
    });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      configurable: true,
      value: async () => undefined
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot: "/workspace/untrusted-terminal-test",
        modulePath: "example.com/mod",
        version: "v1.2.3"
      });

      assert.equal(terminalCreated, false);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        configurable: true,
        get: () => originalIsTrusted
      });
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal
      });
      Object.defineProperty(vscode.window, "showWarningMessage", {
        configurable: true,
        value: originalShowWarningMessage
      });
    }
  });

  test("shows an error and does not create a terminal for an unavailable root", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    assert.ok(extension);
    if (!extension.isActive) await extension.activate();

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const parent = await mkdtemp(path.join(os.tmpdir(), "modbear-terminal-unavailable-command-"));
    const unavailableRoot = path.join(parent, "missing");
    let terminalCreated = false;
    const errors: string[] = [];
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: () => {
        terminalCreated = true;
        throw new Error("terminal must not be created");
      }
    });
    Object.defineProperty(vscode.window, "showErrorMessage", {
      configurable: true,
      value: async (message: string) => {
        errors.push(message);
        return undefined;
      }
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot: unavailableRoot,
        modulePath: "example.com/mod",
        version: "v1.2.3"
      });

      assert.equal(terminalCreated, false);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /ModBear: Could not prepare update: .*module root.*directory/i);
    } finally {
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal
      });
      Object.defineProperty(vscode.window, "showErrorMessage", {
        configurable: true,
        value: originalShowErrorMessage
      });
      await rm(parent, { recursive: true, force: true });
    }
  });

  test("shows an error and does not create a terminal for unsafe arguments", async () => {
    const extension = vscode.extensions.getExtension("diaszano.modbear");
    assert.ok(extension);
    if (!extension.isActive) await extension.activate();

    const originalCreateTerminal = vscode.window.createTerminal;
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    let terminalCreated = false;
    const errors: string[] = [];
    Object.defineProperty(vscode.window, "createTerminal", {
      configurable: true,
      value: () => {
        terminalCreated = true;
        throw new Error("terminal must not be created");
      }
    });
    Object.defineProperty(vscode.window, "showErrorMessage", {
      configurable: true,
      value: async (message: string) => {
        errors.push(message);
        return undefined;
      }
    });

    try {
      await vscode.commands.executeCommand("modBear.prepareUpdateInTerminal", {
        moduleRoot: path.resolve(os.tmpdir()),
        modulePath: "example.com/mod;whoami",
        version: "v1.2.3"
      });

      assert.equal(terminalCreated, false);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /ModBear: Could not prepare update: Invalid module path\./);
    } finally {
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal
      });
      Object.defineProperty(vscode.window, "showErrorMessage", {
        configurable: true,
        value: originalShowErrorMessage
      });
    }
  });
});
