import assert from "node:assert/strict";
import test from "node:test";
import { resolveActiveModule } from "../../discovery/activeModuleResolver";
import type { ModuleContext } from "../../domain/module";

test("resolves active module for document in module", () => {
  const modules: ModuleContext[] = [
    {
      id: "/repo/app",
      moduleRoot: "/repo/app",
      goModPath: "/repo/app/go.mod",
    },
    {
      id: "/repo/app/sub",
      moduleRoot: "/repo/app/sub",
      goModPath: "/repo/app/sub/go.mod",
    },
  ];

  assert.equal(resolveActiveModule("/repo/app/sub/pkg/foo.go", modules)?.id, "/repo/app/sub");
  assert.equal(resolveActiveModule("/repo/app/go.mod", modules)?.id, "/repo/app");
  assert.equal(resolveActiveModule("/repo/app/main.go", modules)?.id, "/repo/app");
  assert.equal(resolveActiveModule("/other/file.go", modules), undefined);
});
