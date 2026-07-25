import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "modbear-vsix-"));
const archive = join(directory, "modbear.vsix");

try {
  const packageResult = spawnSync("npx", ["vsce", "package", "--no-dependencies", "--out", archive], {
    encoding: "utf8",
  });
  assert.equal(packageResult.status, 0, packageResult.stderr);

  const unzipResult = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8" });
  assert.equal(unzipResult.status, 0, unzipResult.stderr);
  const paths = unzipResult.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.toLowerCase());
  const payloadPrefix = "extension/";
  const payloadPaths = paths.filter((path) => path.startsWith(payloadPrefix));
  const rootPaths = paths.filter((path) => !path.startsWith(payloadPrefix));
  const rootMetadata = new Set(["[content_types].xml", "extension.vsixmanifest", "_rels/.rels"]);

  assert.ok(payloadPaths.length > 0, "VSIX must contain an extension payload");
  assert.ok(paths.includes("extension/package.json"), "VSIX payload must remain under extension/");
  const packageJsonResult = spawnSync("unzip", ["-p", archive, "extension/package.json"], {
    encoding: "utf8",
  });
  assert.equal(packageJsonResult.status, 0, packageJsonResult.stderr);
  const packageJson = JSON.parse(packageJsonResult.stdout);
  assert.equal(
    packageJson.capabilities.untrustedWorkspaces.description,
    "Dependency scans execute the Go toolchain in the workspace.",
    "Workspace Trust description must be self-contained in the VSIX manifest",
  );
  for (const path of rootPaths) {
    assert.ok(rootMetadata.has(path), `Unexpected VSIX root metadata path: ${path}`);
  }

  const required = ["package.json", "readme.md", "changelog.md", "license.txt"];
  const requiredPrefixes = ["dist/", "resources/"];
  for (const path of required) {
    assert.ok(payloadPaths.includes(`${payloadPrefix}${path}`), `Required package path missing: ${path}`);
  }
  for (const prefix of requiredPrefixes) {
    assert.ok(
      payloadPaths.some((path) => path.startsWith(`${payloadPrefix}${prefix}`)),
      `Required package path missing: ${prefix}`,
    );
  }

  const forbidden = [
    "src/",
    ".github/",
    ".codex/",
    ".husky/",
    "docs/",
    "scripts/",
    "node_modules/",
    "package-lock.json",
    "tsconfig.json",
    "commitlint.config.js",
    "package.nls.json",
    ".releaserc.json",
    ".nvmrc",
    ".gitignore",
  ];
  for (const path of payloadPaths) {
    const payloadPath = path.slice(payloadPrefix.length);
    assert.ok(
      !forbidden.some((entry) => payloadPath === entry || payloadPath.startsWith(entry)),
      `Forbidden package path: ${payloadPath}`,
    );
    assert.ok(!/^esbuild\..+/.test(payloadPath), `Forbidden package path: ${payloadPath}`);
  }

  const allowed = new Set(["package.json", "readme.md", "changelog.md", "license.txt"]);
  const allowedPrefixes = ["dist/", "resources/"];
  assert.ok((await stat(archive)).size < 2 * 1024 * 1024, "VSIX exceeds 2 MiB budget");
  for (const path of payloadPaths) {
    const payloadPath = path.slice(payloadPrefix.length);
    assert.ok(
      allowed.has(payloadPath) || allowedPrefixes.some((prefix) => payloadPath.startsWith(prefix)),
      `Unexpected package path: ${payloadPath}`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log("VSIX package contract test passed cleanly.");
