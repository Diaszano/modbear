export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface ModuleContext {
  readonly id: string;
  readonly moduleRoot: string;
  readonly goModPath: string;
  readonly goSumPath?: string;
  readonly workspaceFolder?: string;
  readonly goWorkPath?: string;
}

export interface DirectiveValue {
  readonly value: string;
  readonly range: TextRange;
}
