import * as vscode from "vscode";
import { redactCommand } from "./redaction";

export class Logger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel("ModBear", { log: true });

  public command(executable: string, args: readonly string[], cwd: string): void {
    this.channel.debug(`exec ${executable} ${redactCommand(args).join(" ")} cwd=${cwd}`);
  }

  public info(message: string): void { this.channel.info(message); }
  public warn(message: string): void { this.channel.warn(message); }
  public error(message: string): void { this.channel.error(message); }
  public show(): void { this.channel.show(true); }
  public dispose(): void { this.channel.dispose(); }
}
