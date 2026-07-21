import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as vscode from "vscode";

suite("Trust Guards", () => {
  test("aborts scanWorkspace if workspace is untrusted", async () => {
    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => false, configurable: true });
    
    let warningShown = false;
    Object.defineProperty(vscode.window, "showWarningMessage", {
      value: async () => { warningShown = true; return undefined; },
      configurable: true
    });

    const logPath = path.join(os.tmpdir(), `fake-go-log-${Date.now()}.txt`);
    const fakeGoPath = path.join(os.tmpdir(), `fake-go-${Date.now()}.sh`);
    
    await writeFile(fakeGoPath, `#!/bin/sh\necho "$@" >> "${logPath}"\n`, { mode: 0o755 });
    await writeFile(logPath, "");

    const config = vscode.workspace.getConfiguration("modBear");
    const originalGoPath = config.get("go.path");
    await config.update("go.path", fakeGoPath, vscode.ConfigurationTarget.Global);

    try {
      const ext = vscode.extensions.getExtension("diaszano.modbear");
      if (ext && !ext.isActive) await ext.activate();
      
      await vscode.commands.executeCommand("modBear.scanWorkspace");
      
      const logContent = await readFile(logPath, "utf8");
      assert.equal(logContent.trim(), "", "Fake Go executable should not be invoked in untrusted workspace");
      assert.ok(warningShown, "Warning message should be shown");
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", { get: () => originalIsTrusted, configurable: true });
      Object.defineProperty(vscode.window, "showWarningMessage", { value: originalShowWarningMessage, configurable: true });
      await config.update("go.path", originalGoPath, vscode.ConfigurationTarget.Global);
    }
  });
});
