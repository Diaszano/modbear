import * as vscode from "vscode";

export const MODBEAR_DETAILS_SCHEME = "modbear";

const READ_ONLY_NOTICE =
  "> **ModBear generated document.** This view is read-only and its contents stay immutable until a scan " +
  "regenerates them. Suggested commands are not executed by this extension.";

const UNAVAILABLE_CONTENT = "# ModBear\n\nDetails are no longer available.";

export class DetailsDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, string>();

  public set(kind: string, id: string, content: string): vscode.Uri {
    const key = `/${encodeURIComponent(kind)}/${encodeURIComponent(id)}.md`;
    this.documents.set(key, `${READ_ONLY_NOTICE}\n\n${content}`);
    return vscode.Uri.parse(`${MODBEAR_DETAILS_SCHEME}:${key}`);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.path) ?? UNAVAILABLE_CONTENT;
  }

  public dispose(): void {
    this.documents.clear();
  }
}
