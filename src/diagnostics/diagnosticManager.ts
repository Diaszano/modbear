import * as vscode from "vscode";

export class DiagnosticManager implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("modbear");
  public set(uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]): void { this.collection.set(uri, [...diagnostics]); }
  public clear(uri: vscode.Uri): void { this.collection.delete(uri); }
  public dispose(): void { this.collection.dispose(); }
}
