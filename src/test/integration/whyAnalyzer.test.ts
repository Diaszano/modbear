import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { explainDependency } from "../../analyzers/whyAnalyzer";

test("runs go mod why with the selected snapshot dependency as an exact argument", async () => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-why-"));
  try {
    const argsPath = path.join(moduleRoot, "args.json");
    const goPath = path.join(moduleRoot, "go");
    await writeFile(
      goPath,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));\nprocess.stdout.write('example.com/app imports\\n\\texample.com/library\\n');\n`
    );
    await chmod(goPath, 0o755);

    const explanation = await explainDependency({
      module: { id: "why", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
      snapshot: {
        dependencies: [{
          modulePath: "example.com/library",
          installedVersion: "v1.0.0",
          retractionRationales: [],
          errors: []
        }]
      },
      modulePath: "example.com/library",
      goExecutable: goPath,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      trusted: true
    });

    const recorded = { args: JSON.parse(await readFile(argsPath, "utf8")) as string[] };
    assert.deepEqual(recorded.args, ["mod", "why", "-m", "example.com/library"]);
    assert.equal(explanation, "example.com/app imports\n\texample.com/library\n");
  } finally {
    await rm(moduleRoot, { recursive: true, force: true });
  }
});

test("rejects untrusted or stale dependency requests before starting a process", async () => {
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "modbear-why-validation-"));
  try {
    const argsPath = path.join(moduleRoot, "args.json");
    const goPath = path.join(moduleRoot, "go");
    await writeFile(argsPath, "");
    await writeFile(
      goPath,
      `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(argsPath)}, 'started');\n`
    );
    await chmod(goPath, 0o755);
    const request = {
      module: { id: "why", moduleRoot, goModPath: path.join(moduleRoot, "go.mod") },
      snapshot: {
        dependencies: [{
          modulePath: "example.com/library",
          installedVersion: "v1.0.0",
          retractionRationales: [],
          errors: []
        }]
      },
      modulePath: "example.com/library",
      goExecutable: goPath,
      timeoutMs: 1_000,
      signal: new AbortController().signal
    };

    await assert.rejects(
      explainDependency({ ...request, snapshot: { dependencies: [] }, trusted: true }),
      /dependency is no longer available/i
    );
    await assert.rejects(
      explainDependency({ ...request, trusted: false }),
      /workspace is not trusted/i
    );
    assert.equal(await readFile(argsPath, "utf8"), "");
  } finally {
    await rm(moduleRoot, { recursive: true, force: true });
  }
});
