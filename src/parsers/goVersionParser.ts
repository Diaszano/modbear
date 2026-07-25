import type { UpdateKind } from "../domain/dependency";

export interface GoVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
  readonly pseudo: boolean;
}

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/;
const PSEUDO = /^v\d+\.\d+\.\d+-\d{14}-[0-9a-f]{12,}$/;

export function parseGoVersion(value: string): GoVersion | undefined {
  const match = SEMVER.exec(value);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
    pseudo: PSEUDO.test(value),
  };
}

export function classifyUpdate(installed: string, available: string): UpdateKind {
  const current = parseGoVersion(installed);
  const next = parseGoVersion(available);
  if (!current || !next) return "unknown";
  if (next.pseudo) return "pseudo";
  if (next.prerelease) return "prerelease";
  if (next.major !== current.major) return "major";
  if (next.minor !== current.minor) return "minor";
  if (next.patch !== current.patch) return "patch";
  return "unknown";
}
