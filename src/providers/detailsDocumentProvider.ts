import * as vscode from "vscode";
import type { Logger } from "../logging/logger";

const UNAVAILABLE_CONTENT = "# ModBear\n\nDetails are no longer available.";
const READ_ONLY_NOTICE = "# ModBear\n\nThis is a read-only detail document. Suggested commands are not executed by this extension.";

export function validateAdvisoryUri(value: string, logger?: Pick<Logger, "error">): vscode.Uri {
  try {
    const uri = vscode.Uri.parse(value);
    const authority = uri.authority;
    const decodedAuthority = decodeURIComponent(authority);
    if ((uri.scheme !== "http" && uri.scheme !== "https") || !authority || authority.includes("@") || decodedAuthority.includes("@")) {
      throw new Error("invalid advisory URI");
    }
    return uri;
  } catch {
    const message = "Advisory URL must be a credential-free HTTP or HTTPS URL.";
    logger?.error(message);
    throw new Error(message);
  }
}

export class DetailsDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, string>();

  public set(kind: string, id: string, content: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: "modbear",
      path: `/${encodeURIComponent(kind)}/${encodeURIComponent(id)}.md`
    });
    this.documents.set(uri.toString(), `${READ_ONLY_NOTICE}\n\n${content}`);
    return uri;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? UNAVAILABLE_CONTENT;
  }

  public dispose(): void {
    this.documents.clear();
  }
}
