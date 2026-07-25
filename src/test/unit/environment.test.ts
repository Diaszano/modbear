import assert from "node:assert/strict";
import test from "node:test";
import { appendReadonlyGoFlags, buildGoEnvironment } from "../../execution/environment";
import { resolveTool } from "../../execution/toolResolver";
import { redactCommand, redactLogMessage, redactLogText, redactUrlCredentials } from "../../logging/redaction";

test("adds readonly without removing user GOFLAGS", () => {
  assert.equal(appendReadonlyGoFlags("-tags=integration"), "-tags=integration -mod=readonly");
});

test("does not duplicate readonly", () => {
  assert.equal(appendReadonlyGoFlags("-mod=readonly -tags=x"), "-mod=readonly -tags=x");
});

test("buildGoEnvironment sets GOFLAGS", () => {
  const env = buildGoEnvironment({ GOFLAGS: "-tags=unit" });
  assert.equal(env.GOFLAGS, "-tags=unit -mod=readonly");
});

test("redactUrlCredentials redacts passwords in URLs", () => {
  assert.equal(redactUrlCredentials("https://user:password@github.com/repo.git"), "https://***@github.com/repo.git");
});

test("redactCommand redacts arguments", () => {
  const args = ["go", "get", "https://token:secret@example.com/pkg"];
  assert.deepEqual(redactCommand(args), ["go", "get", "https://***@example.com/pkg"]);
});

test("redactLogMessage redacts credentials from raw caught error messages", () => {
  const error = new Error("go list failed for https://token:super-secret@example.com/private/module");

  assert.equal(
    redactLogMessage(`Scan failed for module-a: ${error}`),
    "Scan failed for module-a: Error: go list failed for https://***@example.com/private/module",
  );
});

test("redacts credentials, absolute paths, and secret values in arbitrary log text", () => {
  const value = "go list cwd=/home/alice/private https://u:p@proxy.test token=abc123";
  const result = redactLogText(value);

  assert.doesNotMatch(result, /alice|private|u:p|abc123/);
  assert.match(result, /\[redacted-path\].*https:\/\/\*\*\*@proxy\.test.*token=\*\*\*/);
});

test("redacts authorization schemes and credentials completely", () => {
  const result = redactLogText("request failed Authorization: Bearer top-secret-token");

  assert.equal(result, "request failed Authorization: ***");
  assert.doesNotMatch(result, /Bearer|top-secret-token/);
});

test("resolveTool uses fallback when configured is empty", async () => {
  const tool = await resolveTool(undefined, "go");
  assert.equal(tool, "go");
});

test("resolveTool checks path existence when custom path given", async () => {
  await assert.rejects(resolveTool("/non/existent/path/to/tool", "go"), { code: "ENOENT" });
});

test("resolveTool checks executable permission when non-executable path given", async () => {
  await assert.rejects(resolveTool("./package.json", "go"), (err: unknown) => {
    assert(err instanceof Error);
    return "code" in err && (err.code === "EACCES" || err.code === "EPERM");
  });
});
