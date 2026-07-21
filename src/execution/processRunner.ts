import { spawn } from "node:child_process";

export interface ProcessOptions {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly signal?: AbortSignal;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export class ProcessExecutionError extends Error {
  public constructor(
    message: string,
    public readonly kind: "spawn" | "timeout" | "cancelled" | "output-limit",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProcessExecutionError";
  }
}

export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ProcessExecutionError("Process cancelled", "cancelled"));
      return;
    }

    const started = Date.now();
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finishReject = (error: ProcessExecutionError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGKILL");
      reject(error);
    };

    const timer = setTimeout(() => {
      finishReject(new ProcessExecutionError(`Process timed out after ${options.timeoutMs}ms`, "timeout"));
    }, options.timeoutMs);

    const onAbort = (): void => {
      finishReject(new ProcessExecutionError("Process cancelled", "cancelled"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      finishReject(new ProcessExecutionError(`Failed to start ${options.executable}`, "spawn", error));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.stdoutLimitBytes) {
        finishReject(new ProcessExecutionError("Process stdout exceeded the configured limit", "output-limit"));
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      stderrBytes += chunk.length;
      if (stderrBytes > options.stderrLimitBytes) {
        finishReject(new ProcessExecutionError("Process stderr exceeded the configured limit", "output-limit"));
      }
    });

    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        durationMs: Date.now() - started
      });
    });
  });
}
