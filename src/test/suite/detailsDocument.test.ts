import assert from "node:assert/strict";
import * as vscode from "vscode";
import { DetailsDocumentProvider, validateAdvisoryUri } from "../../providers/detailsDocumentProvider";

suite("DetailsDocumentProvider", () => {
  test("serves read-only transient content", () => {
    const provider = new DetailsDocumentProvider();
    try {
      const uri = provider.set("why", "example.com/library", "Dependency explanation");

      assert.match(provider.provideTextDocumentContent(uri), /Suggested commands are not executed/);
      assert.match(provider.provideTextDocumentContent(uri), /Dependency explanation/);
    } finally {
      provider.dispose();
    }
  });

  test("returns an unavailable message for an unknown URI", () => {
    const provider = new DetailsDocumentProvider();
    try {
      assert.equal(
        provider.provideTextDocumentContent(vscode.Uri.parse("modbear:/missing/item.md")),
        "# ModBear\n\nDetails are no longer available."
      );
    } finally {
      provider.dispose();
    }
  });

  test("clears transient content when disposed", () => {
    const provider = new DetailsDocumentProvider();
    const uri = provider.set("why", "example.com/library", "Dependency explanation");

    provider.dispose();

    assert.equal(provider.provideTextDocumentContent(uri), "# ModBear\n\nDetails are no longer available.");
  });

  test("accepts only credential-free HTTP advisory links", () => {
    assert.throws(() => validateAdvisoryUri("https://user:secret@example.test/advisory"));
    assert.throws(() => validateAdvisoryUri("command:workbench.action.reloadWindow"));
    assert.equal(validateAdvisoryUri("https://pkg.go.dev/example.com/library").scheme, "https");
  });

  test("reports advisory validation failures without exposing the rejected URL", () => {
    const messages: string[] = [];

    assert.throws(() => validateAdvisoryUri("https://user:secret@example.test/advisory", {
      error: (message: string) => messages.push(message)
    }));

    assert.deepEqual(messages, ["Advisory URL must be a credential-free HTTP or HTTPS URL."]);
  });
});
