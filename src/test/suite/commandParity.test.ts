import assert from "node:assert/strict";
import * as vscode from "vscode";

const TRUST_WARNING = "Trust this workspace before running ModBear workspace actions.";
const SCAN_MODULE_WARNING = "ModBear: Open a file inside a Go module to scan it.";
const SHOW_DETAILS_INFO = "ModBear: No dependency details available yet. Run a scan first.";

const EXPECTED_COMMAND_IDS = [
  "modBear.copySuggestion",
  "modBear.explainDependency",
  "modBear.openAdvisory",
  "modBear.scanModule",
  "modBear.scanWorkspace",
  "modBear.showDetails",
  "modBear.showOutput",
  "modBear.showStatusBarMenu",
  "modBear.showTidyDiff",
].sort();

function getDeclaredCommandIds(extension: vscode.Extension<unknown>): string[] {
  const contributes = extension.packageJSON.contributes as { commands?: readonly { command: string }[] } | undefined;
  return (contributes?.commands ?? []).map((entry) => entry.command).filter((id) => id.startsWith("modBear."));
}

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension("diaszano.modbear");
  assert.ok(extension);
  if (!extension.isActive) await extension.activate();
  return extension;
}

suite("Command parity", () => {
  test("registers every command declared in package.json", async () => {
    const extension = await activateExtension();

    const declared = getDeclaredCommandIds(extension);
    assert.ok(declared.length > 0, "package.json should declare ModBear commands");
    assert.deepEqual([...declared].sort(), EXPECTED_COMMAND_IDS, "package.json must declare the full command set");

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((id) => !registered.has(id));
    assert.deepEqual(missing, [], "Every declared ModBear command must be registered");
  });

  test("scanModule shows guidance when no module file is open", async () => {
    await activateExtension();

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const warnings: unknown[] = [];
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => true, configurable: true });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      value: async (message: string) => {
        warnings.push(message);
        return undefined;
      },
      configurable: true,
    });

    try {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      assert.equal(vscode.window.activeTextEditor, undefined);

      await vscode.commands.executeCommand("modBear.scanModule");

      assert.deepEqual(warnings, [SCAN_MODULE_WARNING]);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        get: () => originalIsTrusted,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showWarningMessage", {
        value: originalShowWarningMessage,
        configurable: true,
      });
    }
  });

  test("showDetails advises a scan when no snapshot exists", async () => {
    await activateExtension();

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const infos: unknown[] = [];
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => true, configurable: true });
    Object.defineProperty(vscode.window, "showInformationMessage", {
      value: async (message: string) => {
        infos.push(message);
        return undefined;
      },
      configurable: true,
    });

    try {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      assert.equal(vscode.window.activeTextEditor, undefined);

      await vscode.commands.executeCommand("modBear.showDetails");

      assert.deepEqual(infos, [SHOW_DETAILS_INFO]);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        get: () => originalIsTrusted,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showInformationMessage", {
        value: originalShowInformationMessage,
        configurable: true,
      });
    }
  });

  test("scanModule and showDetails stay gated in an untrusted workspace", async () => {
    await activateExtension();

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const warnings: unknown[] = [];
    const infos: unknown[] = [];
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => false, configurable: true });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      value: async (message: string) => {
        warnings.push(message);
        return undefined;
      },
      configurable: true,
    });
    Object.defineProperty(vscode.window, "showInformationMessage", {
      value: async (message: string) => {
        infos.push(message);
        return undefined;
      },
      configurable: true,
    });

    try {
      await vscode.commands.executeCommand("modBear.scanModule");
      await vscode.commands.executeCommand("modBear.showDetails");

      assert.deepEqual(warnings, [TRUST_WARNING, TRUST_WARNING]);
      assert.deepEqual(infos, []);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        get: () => originalIsTrusted,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showWarningMessage", {
        value: originalShowWarningMessage,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showInformationMessage", {
        value: originalShowInformationMessage,
        configurable: true,
      });
    }
  });

  test("explanation commands stay gated in an untrusted workspace", async () => {
    await activateExtension();

    const originalIsTrusted = vscode.workspace.isTrusted;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalShowInformationMessage = vscode.window.showInformationMessage;
    const warnings: unknown[] = [];
    const infos: unknown[] = [];
    Object.defineProperty(vscode.workspace, "isTrusted", { get: () => false, configurable: true });
    Object.defineProperty(vscode.window, "showWarningMessage", {
      value: async (message: string) => {
        warnings.push(message);
        return undefined;
      },
      configurable: true,
    });
    Object.defineProperty(vscode.window, "showInformationMessage", {
      value: async (message: string) => {
        infos.push(message);
        return undefined;
      },
      configurable: true,
    });

    try {
      await vscode.commands.executeCommand("modBear.explainDependency");
      await vscode.commands.executeCommand("modBear.openAdvisory");
      await vscode.commands.executeCommand("modBear.showTidyDiff");

      assert.deepEqual(warnings, [TRUST_WARNING, TRUST_WARNING, TRUST_WARNING]);
      assert.deepEqual(infos, []);
    } finally {
      Object.defineProperty(vscode.workspace, "isTrusted", {
        get: () => originalIsTrusted,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showWarningMessage", {
        value: originalShowWarningMessage,
        configurable: true,
      });
      Object.defineProperty(vscode.window, "showInformationMessage", {
        value: originalShowInformationMessage,
        configurable: true,
      });
    }
  });
});
