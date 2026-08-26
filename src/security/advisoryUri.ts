import * as vscode from "vscode";

const ALLOWED_SCHEMES = new Set(["http", "https"]);

export function validateAdvisoryUri(link: string): vscode.Uri {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(link, true);
  } catch {
    throw new Error("ModBear rejected an invalid vulnerability advisory link.");
  }
  if (!ALLOWED_SCHEMES.has(uri.scheme)) {
    throw new Error("ModBear rejected a vulnerability advisory link without an http or https scheme.");
  }
  if (uri.authority.includes("@")) {
    throw new Error("ModBear rejected a vulnerability advisory link that embeds credentials.");
  }
  return uri;
}
