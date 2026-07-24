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
    const vulnerabilityLogPath = path.join(os.tmpdir(), `fake-govulncheck-log-${Date.now()}.txt`);
    const fakeGovulncheckPath = path.join(os.tmpdir(), `fake-govulncheck-${Date.now()}.sh`);
    
    await writeFile(fakeGoPath, `#!/bin/sh\necho "$@" >> "${logPath}"\n`, { mode: 0o755 });
    await writeFile(logPath, "");
    await writeFile(fakeGovulncheckPath, `#!/bin/sh\necho "$@" >> "${vulnerabilityLogPath}"\n`, { mode: 0o755 });
    await writeFile(vulnerabilityLogPath, "");

    const config = vscode.workspace.getConfiguration("modBear");
    const originalGoPath = config.get("go.path");
    const originalGovulncheckPath = config.get("govulncheck.path");
    await config.update("go.path", fakeGoPath, vscode.ConfigurationTarget.Global);
    await config.update("govulncheck.path", fakeGovulncheckPath, vscode.ConfigurationTarget.Global);

    try {
      const ext = vscode.extensions.getExtension("diaszano.modbear");
      if (ext && !ext.isActive) await ext.activate();
      
      await vscode.commands.executeCommand("modBear.scanWorkspace");
      
      const logContent = await readFile(logPath, "utf8");
      const vulnerabilityLogContent = await readFile(vulnerabilityLogPath, "utf8");
      assert.equal(logContent.trim(), "", "Fake Go executable should not be invoked in untrusted workspace");
      assert.equal(vulnerabilityLogContent.trim(), "", "Fake govulncheck executable should not be invoked in untrusted workspace");
      assert.ok(warningShown, "Warning message should be shown");
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", { get: () => originalIsTrusted, configurable: true });
      Object.defineProperty(vscode.window, "showWarningMessage", { value: originalShowWarningMessage, configurable: true });
      await config.update("go.path", originalGoPath, vscode.ConfigurationTarget.Global);
      await config.update("govulncheck.path", originalGovulncheckPath, vscode.ConfigurationTarget.Global);
    }
  });
});
