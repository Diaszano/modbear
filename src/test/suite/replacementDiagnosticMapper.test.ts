import assert from "node:assert/strict";
import * as vscode from "vscode";
import { mapReplacementDiagnostics } from "../../diagnostics/replacementDiagnosticMapper";

suite("replacementDiagnosticMapper", () => {
  test("maps a missing local replacement to an error", () => {
    const diagnostics = mapReplacementDiagnostics({
      oldPath: "example.com/old",
      newPath: "../missing",
      local: true,
      line: 0,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 38 } }
    }, {
      sourcePath: "example.com/old",
      targetPath: "/workspace/missing",
      local: true,
      exists: false
    });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostics[0]?.source, "modbear");
    assert.equal(diagnostics[0]?.code, "missing-local-replacement");
  });
});
