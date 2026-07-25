import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { load } from 'js-yaml';

const config = JSON.parse(await readFile('.releaserc.json', 'utf8'));
const plugin = (name) =>
  config.plugins.find((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);

assert.deepEqual(config.branches, ['main', { name: 'dev', prerelease: 'dev' }]);
assert.equal(config.tagFormat, 'v${version}');

const packageText = await readFile('package.json', 'utf8');
const readmeText = await readFile('README.md', 'utf8');
assert.match(packageText, /"modBear\.govulncheck\.path"/);
assert.match(packageText, /"modBear\.vulnerability\.enabled"/);
assert.match(packageText, /"modBear\.vulnerability\.timeoutSeconds"/);
assert.match(readmeText, /vulnerability analysis unavailable/i);
assert.doesNotMatch(readmeText, /free of vulnerabilities|no vulnerabilities/i);

const packageListing = spawnSync(
  resolve('node_modules/.bin/vsce'),
  ['ls', '--tree', '--no-dependencies'],
  { cwd: process.cwd(), encoding: 'utf8', env: process.env },
);
assert.equal(packageListing.status, 0, packageListing.stderr);
assert.doesNotMatch(
  packageListing.stdout,
  /^.*\.superpowers\//m,
  'VSIX package contents must not include Superpowers scratch files',
);
assert.doesNotMatch(
  packageListing.stdout,
  /^.*\.opencode\//m,
  'VSIX package contents must not include OpenCode development files',
);

const analyzer = plugin('@semantic-release/commit-analyzer');
assert.ok(Array.isArray(analyzer));
const rules = new Map(analyzer[1].releaseRules.map(({ type, release }) => [type, release]));
assert.equal(rules.get('feat'), 'minor');
assert.equal(rules.get('fix'), 'patch');
assert.equal(rules.get('perf'), 'patch');
assert.equal(rules.get('revert'), 'patch');
for (const type of ['build', 'chore', 'ci', 'docs', 'refactor', 'style', 'test']) {
  assert.equal(rules.get(type), false);
}

const analyze = (message) =>
  analyzeCommits(analyzer[1], {
    commits: [{ hash: 'release-policy-test', message }],
    cwd: process.cwd(),
    logger: { log() {} },
  });

for (const message of [
  'feat!: break the public API',
  'chore!: break the maintenance API',
  'feat: break the public API\n\nBREAKING CHANGE: callers must migrate',
  'docs: document a breaking API\n\nBREAKING CHANGE: callers must migrate',
]) {
  assert.equal(await analyze(message), 'major', `Expected a major release for: ${message}`);
}

const npmPlugin = plugin('@semantic-release/npm');
assert.equal(npmPlugin[1].npmPublish, false);

const releaseWorkflow = load(await readFile('.github/workflows/release.yml', 'utf8'));
assert.deepEqual(Object.keys(releaseWorkflow.on), ['workflow_call']);
assert.deepEqual(releaseWorkflow.permissions, { contents: 'write', packages: 'write' });

const releaseSteps = releaseWorkflow.jobs.release.steps;
const step = (name) => releaseSteps.find((entry) => entry.name === name);
assert.ok(step('Checkout repository'), 'Checkout repository step missing');
assert.ok(step('Set up Node.js'), 'Set up Node.js step missing');

const snapshotTags = step('Snapshot release tags');
assert.ok(
  snapshotTags,
  'Release workflow must snapshot the stable SemVer tag set before publishing',
);
assert.equal(
  snapshotTags.run,
  '.github/scripts/resolve-release-tag.sh snapshot "$RUNNER_TEMP/release-tags-before.txt"',
);

const resolveRelease = step('Resolve published version');
assert.equal(
  resolveRelease.run,
  '.github/scripts/resolve-release-tag.sh resolve "$RUNNER_TEMP/release-tags-before.txt" "$GITHUB_OUTPUT"',
);

const ciWorkflow = load(await readFile('.github/workflows/ci.yml', 'utf8'));
assert.ok(ciWorkflow.jobs.commitlint, 'Job commitlint should exist in ci.yml');
assert.ok(ciWorkflow.jobs.lint, 'Job lint should exist in ci.yml');
assert.ok(ciWorkflow.jobs.test, 'Job test should exist in ci.yml');
assert.ok(ciWorkflow.jobs.build, 'Job build should exist in ci.yml');

const resolver = resolve('.github/scripts/resolve-release-tag.sh');
const repository = await mkdtemp(join(tmpdir(), 'modbear-release-tags-'));
const beforeTags = join(repository, 'before-tags');
const githubOutput = join(repository, 'github-output');
const run = (command, args) =>
  spawnSync(command, args, { cwd: repository, encoding: 'utf8', env: process.env });
const runChecked = (command, args) => {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stderr);
  return result;
};

try {
  runChecked('git', ['init', '--quiet']);
  runChecked('git', ['config', 'user.name', 'Release Test']);
  runChecked('git', ['config', 'user.email', 'release-test@example.com']);
  runChecked('git', ['commit', '--allow-empty', '--no-gpg-sign', '--message', 'test fixture']);
  runChecked('git', ['tag', 'v1.0.0']);
  runChecked('git', ['tag', 'v999-archive']);

  runChecked(resolver, ['snapshot', beforeTags]);
  runChecked(resolver, ['resolve', beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, 'utf8'), 'published=false\n');

  runChecked('git', ['tag', 'v1000-archive']);
  runChecked('git', ['tag', 'v01.2.3']);
  runChecked('git', ['tag', 'v1.2.3-beta.1']);
  await writeFile(githubOutput, '');
  runChecked(resolver, ['resolve', beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, 'utf8'), 'published=false\n');

  runChecked('git', ['tag', 'v1.2.3']);
  await writeFile(githubOutput, '');
  runChecked(resolver, ['resolve', beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, 'utf8'), 'published=true\nversion=1.2.3\n');

  runChecked('git', ['tag', 'v2.0.0']);
  await writeFile(githubOutput, '');
  const multipleTags = run(resolver, ['resolve', beforeTags, githubOutput]);
  assert.notEqual(multipleTags.status, 0);
  assert.match(multipleTags.stderr, /multiple new stable release tags/i);
} finally {
  await rm(repository, { recursive: true, force: true });
}

console.log('Release configuration test passed cleanly.');
