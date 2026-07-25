import { ProcessExecutionError, type ProcessResult } from "./processRunner";

export function requireSuccessfulExit(result: ProcessResult, command: string): ProcessResult {
  if (result.exitCode === 0 && result.signal === null) return result;
  const detail = result.signal
    ? `${command} terminated by ${result.signal}`
    : `${command} exited with code ${result.exitCode ?? "unknown"}`;
  throw new ProcessExecutionError(detail, "exit-nonzero", undefined, result);
}
