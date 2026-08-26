export type ToolchainPrereleaseKind = "beta" | "rc";

export interface ToolchainPrerelease {
  readonly kind: ToolchainPrereleaseKind;
  readonly number: number;
}

export interface ToolchainVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch?: number;
  readonly prerelease?: ToolchainPrerelease;
}

const VERSION = /^(?:go)?(\d+)\.(\d+)(?:\.(\d+))?(?:(beta|rc)(\d+))?$/;

export function parseToolchainVersion(value: string): ToolchainVersion | undefined {
  const match = VERSION.exec(value);
  if (!match) return undefined;
  const patch = match[3];
  const kind = match[4] as ToolchainPrereleaseKind | undefined;
  const number = match[5];
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    ...(patch ? { patch: Number(patch) } : {}),
    ...(kind && number ? { prerelease: { kind, number: Number(number) } } : {}),
  };
}

export function compareToolchainVersions(left: ToolchainVersion, right: ToolchainVersion): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  const leftPatch = left.patch ?? 0;
  const rightPatch = right.patch ?? 0;
  if (leftPatch !== rightPatch) return leftPatch < rightPatch ? -1 : 1;
  if (!left.prerelease || !right.prerelease) {
    return left.prerelease ? -1 : right.prerelease ? 1 : 0;
  }
  if (left.prerelease.kind !== right.prerelease.kind) return left.prerelease.kind === "beta" ? -1 : 1;
  if (left.prerelease.number !== right.prerelease.number) {
    return left.prerelease.number < right.prerelease.number ? -1 : 1;
  }
  return 0;
}
