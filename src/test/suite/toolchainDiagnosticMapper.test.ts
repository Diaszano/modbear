import assert from "node:assert/strict";
import * as vscode from "vscode";
import { mapToolchainDiagnostics } from "../../diagnostics/toolchainDiagnosticMapper";
import { parseGoModPositions } from "../../parsers/goModPositionParser";

suite("toolchainDiagnosticMapper", () => {
  const parsed = parseGoModPositions("module example.com/app\n\ngo 1.25.0\ntoolchain go1.26.0\n");

  test("maps an installed version below go as an error", () => {
    const belowGo = {
      state: "complete" as const,
      installed: "go1.24.0",
      required: "1.25.0",
      suggested: "go1.26.0",
      errors: []
    };

    const diagnostics = mapToolchainDiagnostics(parsed, belowGo);

    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostics[0]?.code, "go-version");
    assert.deepEqual(diagnostics[0]?.range, new vscode.Range(2, 3, 2, 9));
  });

  test("maps an installed version below the suggested toolchain as a warning", () => {
    const belowSuggested = {
      state: "complete" as const,
      installed: "go1.25.0",
      required: "1.25.0",
      suggested: "go1.26.0",
      errors: []
    };

    const diagnostics = mapToolchainDiagnostics(parsed, belowSuggested);

    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Warning);
    assert.equal(diagnostics[0]?.code, "toolchain-version");
    assert.deepEqual(diagnostics[0]?.range, new vscode.Range(3, 10, 3, 18));
  });

  test("maps unavailable Go to the module directive", () => {
    const unavailable = {
      state: "unavailable" as const,
      errors: [{ code: "tool-not-found" as const, message: "Toolchain analysis is unavailable." }]
    };

    const diagnostics = mapToolchainDiagnostics(parsed, unavailable);

    assert.equal(diagnostics[0]?.range.start.line, parsed.module!.range.start.line);
    assert.equal(diagnostics[0]?.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(diagnostics[0]?.code, "toolchain-unavailable");
  });

  test("maps malformed directive values without executing a process", () => {
    const malformed = parseGoModPositions("module example.com/app\n\ngo 1.x\ntoolchain go1.26rcx\n");
    const diagnostics = mapToolchainDiagnostics(malformed, {
      state: "failed",
      installed: "go1.25.0",
      required: "1.x",
      suggested: "go1.26rcx",
      errors: [{ code: "unknown", message: "Toolchain analysis failed." }]
    });

    assert.equal(diagnostics.length, 2);
    assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Warning));
    assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), ["go-version", "toolchain-version"]);
  });
});
