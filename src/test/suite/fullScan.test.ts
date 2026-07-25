import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalysisCache } from "../../cache/analysisCache";
import { ModuleScanner } from "../../orchestration/moduleScanner";

suite("full scan composition", () => {
  test("runs tidy only for a manual scan while retaining update and toolchain results", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modbear-full-scan-"));
    try {
      const goModPath = path.join(root, "go.mod");
      const tidyCountPath = path.join(root, "tidy-count");
      const goPath = path.join(root, "go");
      await writeFile(goModPath, "module example.com/app\n\ngo 1.24.0\n\nrequire example.com/library v1.0.0\n");
      await writeFile(tidyCountPath, "0");
      await writeFile(goPath, `#!/usr/bin/env node
const fs = require("node:fs");
const [command, ...args] = process.argv.slice(2);
if (command === "version") process.stdout.write("go version go1.25.0 linux/amd64\\n");
if (command === "env") process.stdout.write("go1.25.0\\n");
if (command === "list") process.stdout.write(JSON.stringify({ Path: "example.com/library", Version: "v1.0.0" }));
if (command === "mod" && args[0] === "tidy") fs.writeFileSync(${JSON.stringify(tidyCountPath)}, "1");
`);
      await chmod(goPath, 0o755);
      const scanner = new ModuleScanner(
        new AnalysisCache(path.join(root, "cache")),
        goPath,
        5_000,
        60_000,
        undefined,
        undefined,
        { tidyEnabled: true, tidyTtlMs: 60_000, vulnerabilityTtlMs: 60_000 }
      );
      const module = { id: "app", moduleRoot: root, goModPath };

      const background = await scanner.scan(module, new AbortController().signal, "background");
      assert.equal(await readFile(tidyCountPath, "utf8"), "0");
      assert.equal(background.dependencies.length, 1);
      assert.equal(background.toolchain.state, "complete");

      const manual = await scanner.scan(module, new AbortController().signal, "manual");
      assert.equal(await readFile(tidyCountPath, "utf8"), "1");
      assert.equal(manual.tidy.state, "complete");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
