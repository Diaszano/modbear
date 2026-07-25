import * as vscode from "vscode";
import { redactLogText } from "./redaction";

export type LogLevel = "error" | "warn" | "info" | "debug";

type LogChannel = Pick<vscode.LogOutputChannel, "debug" | "info" | "warn" | "error" | "show" | "dispose">;

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export class Logger implements vscode.Disposable {
  private readonly channel: LogChannel;

  public constructor(
    private readonly getLevel: () => LogLevel = () => "info",
    createChannel: () => LogChannel = () => vscode.window.createOutputChannel("ModBear", { log: true }),
  ) {
    this.channel = createChannel();
  }

  public event(level: LogLevel, name: string, fields: Readonly<Record<string, string | number | boolean>>): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.getLevel()]) return;
    const body = Object.entries(fields)
      .map(([key, value]) => `${key}=${redactLogText(String(value))}`)
      .join(" ");
    this.channel[level](`${name}${body ? ` ${body}` : ""}`);
  }

  public command(executable: string, args: readonly string[], cwd: string): void {
    const command = [executable, ...args].map(redactLogText).join(" ");
    this.event("debug", "process.command", { command: `${command} cwd=${redactLogText(cwd)}` });
  }

  public info(message: string): void {
    this.event("info", "log", { message });
  }
  public warn(message: string): void {
    this.event("warn", "log", { message });
  }
  public error(message: string): void {
    this.event("error", "log", { message });
  }
  public show(): void {
    this.channel.show(true);
  }
  public dispose(): void {
    this.channel.dispose();
  }
}
