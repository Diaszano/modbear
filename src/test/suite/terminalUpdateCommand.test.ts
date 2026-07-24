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
        moduleRoot: "/workspace/terminal-command-test",
        modulePath: "github.com/gin-gonic/gin",
        version: "v1.10.1"
      });

      assert.equal(receivedOptions?.name, "ModBear");
      assert.equal(receivedOptions?.cwd, "/workspace/terminal-command-test");
      assert.deepEqual(sent, [{
        text: "go get github.com/gin-gonic/gin@v1.10.1",
        shouldExecute: false
      }]);
    } finally {
      Object.defineProperty(vscode.window, "createTerminal", {
        configurable: true,
        value: originalCreateTerminal
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
});
