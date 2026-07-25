import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'modbear-vsix-'));
const archive = join(directory, 'modbear.vsix');

try {
  const packageResult = spawnSync('npx', ['vsce', 'package', '--no-dependencies', '--out', archive], {
    encoding: 'utf8',
  });
  assert.equal(packageResult.status, 0, packageResult.stderr);

  const unzipResult = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
  assert.equal(unzipResult.status, 0, unzipResult.stderr);
  const paths = unzipResult.stdout
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replace(/^extension\//, '').toLowerCase());

  const required = ['package.json', 'readme.md', 'changelog.md', 'license.txt'];
  const requiredPrefixes = ['dist/', 'resources/'];
  for (const path of required) {
    assert.ok(paths.includes(path), `Required package path missing: ${path}`);
  }
  for (const prefix of requiredPrefixes) {
    assert.ok(paths.some((path) => path.startsWith(prefix)), `Required package path missing: ${prefix}`);
  }

  const forbidden = [
    'src/',
    '.github/',
    '.codex/',
    '.husky/',
    'docs/',
    'scripts/',
    'node_modules/',
    'package-lock.json',
    'tsconfig.json',
    'commitlint.config.js',
    '.releaserc.json',
    '.nvmrc',
    '.gitignore',
  ];
  for (const path of paths) {
    assert.ok(!forbidden.some((entry) => path === entry || path.startsWith(entry)), `Forbidden package path: ${path}`);
    assert.ok(!/^esbuild\..+/.test(path), `Forbidden package path: ${path}`);
  }

  const allowed = new Set(['package.json', 'package.nls.json', 'readme.md', 'changelog.md', 'license.txt']);
  const allowedPrefixes = ['dist/', 'resources/', '[content_types].xml', '_rels/', 'extension.vsixmanifest'];
  assert.ok((await stat(archive)).size < 2 * 1024 * 1024, 'VSIX exceeds 2 MiB budget');
  for (const path of paths) {
    assert.ok(
      allowed.has(path) || allowedPrefixes.some((prefix) => path.startsWith(prefix)),
      `Unexpected package path: ${path}`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('VSIX package contract test passed cleanly.');
