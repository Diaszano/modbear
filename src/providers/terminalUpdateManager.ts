import { statSync } from "node:fs";
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
    assertAvailableModuleRoot(args.moduleRoot);
    let terminal = this.terminalsByRoot.get(args.moduleRoot);
    if (!terminal) {
      terminal = this.createTerminal({ name: "ModBear", cwd: args.moduleRoot });
      this.terminalsByRoot.set(args.moduleRoot, terminal);
    }
    try {
      terminal.show();
      terminal.sendText(buildGoGetSuggestion(args), false);
    } catch (error) {
      this.forget(terminal);
      throw error;
    }
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

function assertAvailableModuleRoot(moduleRoot: string): void {
  try {
    if (statSync(moduleRoot).isDirectory()) {
      const goModPath = path.join(moduleRoot, "go.mod");
      try {
        if (statSync(goModPath).isFile()) return;
      } catch {
        // Report a consistent availability error below.
      }
      throw new Error(`Module root is unavailable: ${goModPath} must be a regular file.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Module root is unavailable:")) {
      throw error;
    }
  }
  throw new Error(`Module root is unavailable: ${moduleRoot} must be an existing directory.`);
}
