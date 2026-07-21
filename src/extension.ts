import * as vscode from "vscode";
import { EXTENSION_ID } from "./metadata";

export { EXTENSION_ID };

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("ModBear", { log: true });
  context.subscriptions.push(output);
  output.info(`${EXTENSION_ID} activated; trusted=${vscode.workspace.isTrusted}`);
}

export function deactivate(): void {}
