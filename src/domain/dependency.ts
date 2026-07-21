import type { TextRange } from "./module";

export type UpdateKind = "patch" | "minor" | "major" | "prerelease" | "pseudo" | "unknown";

export interface GoModRequirement {
  readonly modulePath: string;
  readonly version: string;
  readonly indirect: boolean;
  readonly line: number;
  readonly moduleRange: TextRange;
  readonly versionRange: TextRange;
}

export interface GoModReplacement {
  readonly oldPath: string;
  readonly oldVersion?: string;
  readonly newPath: string;
  readonly newVersion?: string;
  readonly local: boolean;
  readonly line: number;
  readonly range: TextRange;
}

export interface ParsedGoMod {
  readonly module?: { readonly path: string; readonly range: TextRange };
  readonly go?: { readonly version: string; readonly range: TextRange };
  readonly toolchain?: { readonly version: string; readonly range: TextRange };
  readonly requirements: readonly GoModRequirement[];
  readonly replacements: readonly GoModReplacement[];
}
