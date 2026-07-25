export interface ToolchainVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: "beta" | "rc";
  readonly prereleaseNumber?: number;
}

const VERSION = /^(?:go)?(\d+)\.(\d+)(?:\.(\d+))?(?:(beta|rc)(\d+))?$/;

export function parseToolchainVersion(value: string): ToolchainVersion | undefined {
  const match = VERSION.exec(value.trim());
  if (!match) return undefined;

  const prerelease = match[4] as ToolchainVersion["prerelease"];
  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? "0"),
    ...(prerelease ? { prerelease, prereleaseNumber: Number(match[5]) } : {})
  });
}

export function compareToolchainVersions(left: ToolchainVersion, right: ToolchainVersion): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  if (left.prerelease !== right.prerelease) return left.prerelease === "beta" ? -1 : 1;
  if (left.prereleaseNumber === right.prereleaseNumber) return 0;
  return (left.prereleaseNumber ?? 0) < (right.prereleaseNumber ?? 0) ? -1 : 1;
}
