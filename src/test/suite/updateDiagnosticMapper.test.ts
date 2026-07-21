import assert from "node:assert/strict";
import * as vscode from "vscode";
import { mapUpdateDiagnostics } from "../../diagnostics/updateDiagnosticMapper";

const requirement = {
  modulePath: "example.com/a",
  version: "v1.0.0",
  indirect: false,
  line: 0,
  moduleRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 13 } },
  versionRange: { start: { line: 0, character: 14 }, end: { line: 0, character: 20 } }
};

const status = {
  modulePath: "example.com/a",
  installedVersion: "v1.0.0",
  availableVersion: "v1.1.0",
  updateKind: "minor" as const,
  deprecatedMessage: "use example.com/b",
  retractionRationales: ["bad release"],
  errors: []
};

suite("updateDiagnosticMapper", () => {
  test("maps lifecycle warnings and suppresses update diagnostics by default", () => {
    const diagnostics = mapUpdateDiagnostics(requirement, status, "none");
    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.every((item) => item.severity === vscode.DiagnosticSeverity.Warning));
    assert.ok(diagnostics.every((item) => item.source === "modbear"));
  });
});
