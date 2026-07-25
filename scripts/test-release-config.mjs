import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { load } from "js-yaml";

const config = JSON.parse(await readFile(".releaserc.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const nvmrc = (await readFile(".nvmrc", "utf8")).trim();
const [
  ciWorkflow,
  releaseWorkflow,
  prTitleWorkflow,
  dependabot,
  codeowners,
  prTemplate,
  bugReport,
  featureRequest,
  issueConfig,
] = await Promise.all([
  readFile(".github/workflows/ci.yml", "utf8").then(load),
  readFile(".github/workflows/release.yml", "utf8").then(load),
  readFile(".github/workflows/pr-title.yml", "utf8").then(load),
  readFile(".github/dependabot.yml", "utf8").then(load),
  readFile(".github/CODEOWNERS", "utf8"),
  readFile(".github/pull_request_template.md", "utf8"),
  readFile(".github/ISSUE_TEMPLATE/bug_report.yml", "utf8").then(load),
  readFile(".github/ISSUE_TEMPLATE/feature_request.yml", "utf8").then(load),
  readFile(".github/ISSUE_TEMPLATE/config.yml", "utf8").then(load),
]);

assert.equal(packageJson.engines.node, ">=24 <25");
assert.equal(packageJson.engines.vscode, "^1.125.0");
assert.equal(packageLock.packages[""].engines.node, ">=24 <25");
assert.equal(packageLock.packages[""].engines.vscode, "^1.125.0");
assert.equal(nvmrc, "24");
assert.equal(
  packageJson.scripts["check-types"],
  "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.tools.json --noEmit",
);
assert.equal(packageJson.scripts["test:package"], "node scripts/test-package-config.mjs");

const actionRefs = {
  "actions/checkout": "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
  "actions/setup-node": "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/dependency-review-action": "actions/dependency-review-action@3b139cfc5fae8b618d3eae3675e383bb1769c019",
};
const workflows = { ci: ciWorkflow, release: releaseWorkflow, prTitle: prTitleWorkflow };
const expectAction = (workflowName, jobName, action) => {
  const job = workflows[workflowName].jobs[jobName];
  assert.ok(job, `${workflowName} must define the ${jobName} job`);
  const actionStep = job.steps?.find((entry) => entry.uses?.startsWith(`${action}@`));
  assert.ok(actionStep, `${workflowName} ${jobName} must use ${action}`);
  assert.equal(actionStep.uses, actionRefs[action], `${workflowName} ${jobName} must pin ${action}`);
  if (action === "actions/setup-node") {
    assert.equal(actionStep.with?.["node-version"], 24, `${workflowName} ${jobName} must use Node 24`);
  }
};
expectAction("ci", "dependency-review", "actions/dependency-review-action");
expectAction("ci", "dependency-review", "actions/checkout");
for (const jobName of ["commitlint", "lint", "test", "test-release", "build"]) {
  expectAction("ci", jobName, "actions/checkout");
  expectAction("ci", jobName, "actions/setup-node");
}
expectAction("prTitle", "commitlint", "actions/checkout");
expectAction("prTitle", "commitlint", "actions/setup-node");
expectAction("release", "release", "actions/checkout");
expectAction("release", "release", "actions/setup-node");
for (const workflow of Object.values(workflows)) {
  for (const job of Object.values(workflow.jobs)) {
    for (const workflowStep of job.steps ?? []) {
      for (const [action, reference] of Object.entries(actionRefs)) {
        if (workflowStep.uses?.startsWith(`${action}@`)) {
          assert.equal(workflowStep.uses, reference, `${action} must be pinned to its reviewed commit`);
        }
      }
      if (workflowStep.uses === actionRefs["actions/setup-node"]) {
        assert.equal(workflowStep.with?.["node-version"], 24, "Node setup must use Node 24");
      }
    }
  }
}

assert.equal(ciWorkflow.jobs.release.needs, "quality");
assert.deepEqual(ciWorkflow.jobs.quality.needs, ["commitlint", "lint", "test", "test-release", "build"]);

const semanticRelease = releaseWorkflow.jobs.release.steps.find((entry) => entry.id === "semantic-release");
assert.ok(semanticRelease, "Semantic Release step missing");
assert.equal(semanticRelease["continue-on-error"], undefined, "Semantic Release failures must block delivery");

const marketplacePublish = releaseWorkflow.jobs.release.steps.find(
  (entry) => entry.name === "Publish to VS Code Marketplace",
);
assert.ok(marketplacePublish, "Marketplace publication step missing");
assert.equal(
  marketplacePublish.if.replace(/\s+/g, " ").trim(),
  "steps.release.outputs.published == 'true' && steps.marketplace.outputs.available == 'true'",
  "Marketplace publication must require both a published release and an available credential",
);

assert.equal(codeowners, "* @diaszano\n.github/ @diaszano\n");
assert.deepEqual(dependabot.version, 2);
assert.deepEqual(
  dependabot.updates.map(({ "package-ecosystem": ecosystem, directory, schedule, "target-branch": targetBranch }) => ({
    ecosystem,
    directory,
    schedule,
    targetBranch,
  })),
  [
    {
      ecosystem: "npm",
      directory: "/",
      schedule: { interval: "weekly", day: "monday", time: "09:00", timezone: "America/Sao_Paulo" },
      targetBranch: "dev",
    },
    {
      ecosystem: "github-actions",
      directory: "/",
      schedule: { interval: "weekly", day: "monday", time: "09:00", timezone: "America/Sao_Paulo" },
      targetBranch: "dev",
    },
  ],
);
for (const term of [
  "Conventional Commit",
  "npm run lint",
  "npm run check-types",
  "npm run test:unit",
  "npm run test:integration",
  "npm run test:extension",
  "npm run test:release",
  "npm run test:package",
  "documentation",
]) {
  assert.match(prTemplate, new RegExp(term, "i"), `PR template must include ${term}`);
}
const fieldIds = (form) => form.body.filter((entry) => entry.id).map((entry) => entry.id);
for (const id of [
  "vscode-version",
  "operating-system",
  "go-version",
  "go-path",
  "govulncheck-version",
  "govulncheck-path",
  "modbear-version",
  "reproduction",
  "expected-behavior",
  "actual-behavior",
]) {
  assert.ok(fieldIds(bugReport).includes(id), `Bug report must include ${id}`);
}
for (const id of ["problem", "proposed-solution"]) {
  assert.ok(fieldIds(featureRequest).includes(id), `Feature request must include ${id}`);
}
assert.equal(issueConfig.blank_issues_enabled, false);
assert.equal(issueConfig.contact_links[0].url, "https://github.com/Diaszano/modbear/security/advisories/new");

const plugin = (name) => config.plugins.find((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);

assert.deepEqual(config.branches, ["main", { name: "dev", prerelease: "dev" }]);
assert.equal(config.tagFormat, "v${version}");

const packageText = await readFile("package.json", "utf8");
const readmeText = await readFile("README.md", "utf8");
assert.match(packageText, /"modBear\.govulncheck\.path"/);
assert.match(packageText, /"modBear\.vulnerability\.enabled"/);
assert.match(packageText, /"modBear\.vulnerability\.timeoutSeconds"/);
assert.match(readmeText, /vulnerability analysis unavailable/i);
assert.doesNotMatch(readmeText, /free of vulnerabilities|no vulnerabilities/i);

const analyzer = plugin("@semantic-release/commit-analyzer");
assert.ok(Array.isArray(analyzer));
const rules = new Map(analyzer[1].releaseRules.map(({ type, release }) => [type, release]));
assert.equal(rules.get("feat"), "minor");
assert.equal(rules.get("fix"), "patch");
assert.equal(rules.get("perf"), "patch");
assert.equal(rules.get("revert"), "patch");
for (const type of ["build", "chore", "ci", "docs", "refactor", "style", "test"]) {
  assert.equal(rules.get(type), false);
}

const analyze = (message) =>
  analyzeCommits(analyzer[1], {
    commits: [{ hash: "release-policy-test", message }],
    cwd: process.cwd(),
    logger: { log() {} },
  });

for (const message of [
  "feat!: break the public API",
  "chore!: break the maintenance API",
  "feat: break the public API\n\nBREAKING CHANGE: callers must migrate",
  "docs: document a breaking API\n\nBREAKING CHANGE: callers must migrate",
]) {
  assert.equal(await analyze(message), "major", `Expected a major release for: ${message}`);
}

const npmPlugin = plugin("@semantic-release/npm");
assert.equal(npmPlugin[1].npmPublish, false);

assert.deepEqual(Object.keys(releaseWorkflow.on), ["workflow_call"]);
assert.deepEqual(releaseWorkflow.permissions, { contents: "write", packages: "write" });

const releaseSteps = releaseWorkflow.jobs.release.steps;
const step = (name) => releaseSteps.find((entry) => entry.name === name);
assert.ok(step("Checkout repository"), "Checkout repository step missing");
assert.ok(step("Set up Node.js"), "Set up Node.js step missing");

const snapshotTags = step("Snapshot release tags");
assert.ok(snapshotTags, "Release workflow must snapshot the stable SemVer tag set before publishing");
assert.equal(
  snapshotTags.run,
  '.github/scripts/resolve-release-tag.sh snapshot "$RUNNER_TEMP/release-tags-before.txt"',
);

const resolveRelease = step("Resolve published version");
assert.equal(
  resolveRelease.run,
  '.github/scripts/resolve-release-tag.sh resolve "$RUNNER_TEMP/release-tags-before.txt" "$GITHUB_OUTPUT"',
);

assert.ok(ciWorkflow.jobs.commitlint, "Job commitlint should exist in ci.yml");
assert.ok(ciWorkflow.jobs.lint, "Job lint should exist in ci.yml");
assert.ok(ciWorkflow.jobs.test, "Job test should exist in ci.yml");
assert.ok(ciWorkflow.jobs.build, "Job build should exist in ci.yml");

const resolver = resolve(".github/scripts/resolve-release-tag.sh");
const repository = await mkdtemp(join(tmpdir(), "modbear-release-tags-"));
const beforeTags = join(repository, "before-tags");
const githubOutput = join(repository, "github-output");
const run = (command, args) => spawnSync(command, args, { cwd: repository, encoding: "utf8", env: process.env });
const runChecked = (command, args) => {
  const result = run(command, args);
  assert.equal(result.status, 0, result.stderr);
  return result;
};

try {
  runChecked("git", ["init", "--quiet"]);
  runChecked("git", ["config", "user.name", "Release Test"]);
  runChecked("git", ["config", "user.email", "release-test@example.com"]);
  runChecked("git", ["commit", "--allow-empty", "--no-gpg-sign", "--message", "test fixture"]);
  runChecked("git", ["tag", "v1.0.0"]);
  runChecked("git", ["tag", "v999-archive"]);

  runChecked(resolver, ["snapshot", beforeTags]);
  runChecked(resolver, ["resolve", beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, "utf8"), "published=false\n");

  runChecked("git", ["tag", "v1000-archive"]);
  runChecked("git", ["tag", "v01.2.3"]);
  runChecked("git", ["tag", "v1.2.3-beta.1"]);
  await writeFile(githubOutput, "");
  runChecked(resolver, ["resolve", beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, "utf8"), "published=false\n");

  runChecked("git", ["tag", "v1.2.3"]);
  await writeFile(githubOutput, "");
  runChecked(resolver, ["resolve", beforeTags, githubOutput]);
  assert.equal(await readFile(githubOutput, "utf8"), "published=true\nversion=1.2.3\n");

  runChecked("git", ["tag", "v2.0.0"]);
  await writeFile(githubOutput, "");
  const multipleTags = run(resolver, ["resolve", beforeTags, githubOutput]);
  assert.notEqual(multipleTags.status, 0);
  assert.match(multipleTags.stderr, /multiple new stable release tags/i);
} finally {
  await rm(repository, { recursive: true, force: true });
}

console.log("Release configuration test passed cleanly.");
