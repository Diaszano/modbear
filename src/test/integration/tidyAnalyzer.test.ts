import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeTidy } from "../../analyzers/tidyAnalyzer";

async function sha256(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

test("runs go mod tidy in diff mode without mutating module files", async () => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-tidy-"));
  try {
    const goModPath = path.join(moduleRoot, "go.mod");
    const goSumPath = path.join(moduleRoot, "go.sum");
    const argsPath = path.join(moduleRoot, "args.json");
    const goPath = path.join(moduleRoot, "go");
    const diff = "diff current/go.mod tidy/go.mod\n--- current/go.mod\n+++ tidy/go.mod\n@@ -1 +1 @@\n";
    await writeFile(goModPath, "module example.com/tidy\n\ngo 1.22\n");
    await writeFile(goSumPath, "example.com/dep v1.0.0 h1:unchanged\n");
    await writeFile(
      goPath,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write(${JSON.stringify(diff)});\nprocess.exit(1);\n`
    );
    await chmod(goPath, 0o755);
    const beforeGoMod = await sha256(goModPath);
    const beforeGoSum = await sha256(goSumPath);

    const tidy = await analyzeTidy({
      module: { id: "tidy", moduleRoot, goModPath, goSumPath },
      goExecutable: goPath,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    });

    const recorded = { args: JSON.parse(await readFile(argsPath, "utf8")) as string[] };
    assert.deepEqual(recorded.args, ["mod", "tidy", "-diff"]);
    assert.equal(await sha256(goModPath), beforeGoMod);
    assert.equal(await sha256(goSumPath), beforeGoSum);
    assert.deepEqual(tidy, {
      state: "complete",
      consistent: false,
      diff,
      errors: []
    });
  } finally {
    await rm(moduleRoot, { recursive: true, force: true });
  }
});
