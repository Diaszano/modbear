import assert from "node:assert/strict";
import * as vscode from "vscode";
import { mapTidyDiagnostic } from "../../diagnostics/tidyDiagnosticMapper";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

suite("tidyDiagnosticMapper", () => {
  test("maps complete tidy differences to the module declaration", () => {
    const parsed = parseGoModPositions("module example.com/app\n\ngo 1.22\n");
    const inconsistent = {
      state: "complete" as const,
      consistent: false,
      diff: "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n",
      errors: []
    };

    const diagnostic = mapTidyDiagnostic(parsed, inconsistent);

    assert.equal(diagnostic?.code, "tidy-diff");
    assert.equal(diagnostic?.source, "modbear");
    assert.equal(diagnostic?.severity, vscode.DiagnosticSeverity.Warning);
    assert.deepEqual(diagnostic?.range, new vscode.Range(0, 7, 0, 22));
  });

  test("suppresses diagnostics unless tidy analysis completed with a difference", () => {
    const parsed = parseGoModPositions("module example.com/app\n");

    assert.equal(mapTidyDiagnostic(parsed, { state: "failed", consistent: false, errors: [] }), undefined);
    assert.equal(mapTidyDiagnostic(parsed, { state: "complete", consistent: true, errors: [] }), undefined);
  });
});
