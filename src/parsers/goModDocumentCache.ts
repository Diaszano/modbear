import type * as vscode from "vscode";
import { parseGoModPositions } from "./goModPositionParser";

interface CachedDocument {
  readonly version: number;
  readonly parsed: ReturnType<typeof parseGoModPositions>;
}

export class GoModDocumentCache implements vscode.Disposable {
  private readonly entries = new Map<string, CachedDocument>();

  public get(document: vscode.TextDocument): CachedDocument["parsed"] {
    const key = document.uri.toString();
    const current = this.entries.get(key);
    if (current?.version === document.version) return current.parsed;
    const parsed = parseGoModPositions(document.getText());
    this.entries.set(key, { version: document.version, parsed });
    return parsed;
  }

  public delete(uri: vscode.Uri): void {
    this.entries.delete(uri.toString());
  }

  public clear(): void {
    this.entries.clear();
  }

  public dispose(): void {
    this.clear();
  }
}
