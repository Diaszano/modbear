export type TidyCommandResult =
  | { readonly kind: "clean" }
  | { readonly kind: "diff"; readonly diff: string }
  | { readonly kind: "error"; readonly message: string };

export function classifyTidyResult(
  exitCode: number | null,
  stdout: string,
  stderr: string
): TidyCommandResult {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("diff ") && trimmed.includes("\n--- ") && trimmed.includes("\n+++ ")) {
    return { kind: "diff", diff: stdout };
  }
  if (exitCode === 0 && !trimmed && !stderr.trim()) {
    return { kind: "clean" };
  }
  return { kind: "error", message: stderr.trim() || trimmed || "go mod tidy -diff exited " + exitCode };
}
