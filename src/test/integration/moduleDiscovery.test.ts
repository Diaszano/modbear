import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverModules } from "../../discovery/moduleDiscovery";

test("discovers recursive modules, excludes vendor, and includes go.work members outside the root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "gdh-discovery-"));
  const root = path.join(parent, "workspace");
  const app = path.join(root, "app");
  const shared = path.join(parent, "shared");
  await mkdir(app, { recursive: true });
  await mkdir(shared, { recursive: true });
  await mkdir(path.join(root, "vendor", "ignored"), { recursive: true });
  await writeFile(path.join(root, "go.work"), "go 1.24\nuse (\n  ./app\n  ../shared\n)\n");
  await writeFile(path.join(app, "go.mod"), "module example.com/app\n");
  await writeFile(path.join(shared, "go.mod"), "module example.com/shared\n");
  await writeFile(path.join(root, "vendor", "ignored", "go.mod"), "module ignored\n");

  const modules = await discoverModules([root], new AbortController().signal);
  const modulesList = modules.modules;
  assert.equal(modulesList.length, 2);
  const realApp = await realpath(app);
  const realShared = await realpath(shared);
  const goWorkPath = await realpath(path.join(root, "go.work"));
  assert.equal(modulesList.find((module: any) => module.moduleRoot === realApp)?.goWorkPath, goWorkPath);
  assert.equal(modulesList.find((module: any) => module.moduleRoot === realShared)?.goWorkPath, goWorkPath);
});

test(
  "discovery continues on sibling directories if a directory read fails",
  { skip: process.platform === "win32" ? "Not supported on Windows" : false },
  async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "gdh-discovery-error-"));
    const root = path.join(parent, "workspace");
    const siblingApp = path.join(root, "siblingApp");
    const failedDir = path.join(root, "failedDir");

    await mkdir(siblingApp, { recursive: true });
    await mkdir(failedDir, { recursive: true });
    await writeFile(path.join(siblingApp, "go.mod"), "module example.com/sibling\n");

    const { chmod } = await import("node:fs/promises");
    await chmod(failedDir, 0o000);

    try {
      const res = await discoverModules([root], new AbortController().signal);

      const modules = res.modules;
      const errors = res.errors;
      assert.ok(modules, "Result should have modules list");
      assert.equal(modules.length, 1);
      assert.equal(modules[0]?.id, await realpath(siblingApp));
      assert.equal(errors.length, 1);
      const err = errors[0];
      assert.ok(err, "Should have returned an error");
      const code = (err as any).code || "";
      assert.match(code || err.message, /EACCES|EPERM|permission/i);
    } finally {
      await chmod(failedDir, 0o755).catch(() => {});
    }
  },
);
