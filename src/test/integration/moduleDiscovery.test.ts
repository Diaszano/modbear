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
  assert.equal(modules.length, 2);
  const realApp = await realpath(app);
  const realShared = await realpath(shared);
  const goWorkPath = await realpath(path.join(root, "go.work"));
  assert.equal(modules.find((module) => module.moduleRoot === realApp)?.goWorkPath, goWorkPath);
  assert.equal(modules.find((module) => module.moduleRoot === realShared)?.goWorkPath, goWorkPath);
});
