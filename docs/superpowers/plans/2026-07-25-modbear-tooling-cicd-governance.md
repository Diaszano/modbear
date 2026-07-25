# ModBear Tooling, CI/CD, and Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align ModBear's local developer standards, package contract, GitHub Actions delivery pipeline, and repository governance with the approved BufBear-derived baseline.

**Architecture:** Preserve ModBear's Node test runner and Extension Host suite while adding reproducible Node 24 tooling checks around them. Treat `scripts/test-release-config.mjs` and a new VSIX contract script as executable policy: workflow, package, and governance changes must be asserted locally before GitHub Actions consumes them.

**Tech Stack:** Node.js 24, TypeScript 5.7, ESLint 10 with `typescript-eslint`, Prettier 3, Husky 9, Commitlint 21, esbuild, `@vscode/vsce`, Semantic Release, GitHub Actions, Node's built-in test runner.

## Global Constraints

- Upgrade the declared runtime to Node `>=24 <25`, add `.nvmrc` containing `24`, and set the VS Code engine to `^1.125.0`.
- Preserve the existing extension behavior, Go and `govulncheck` integrations, Node unit/integration tests, and Extension Host tests; do not migrate test frameworks.
- Retain `main` and prerelease `dev` Semantic Release branches; only `dev`/`development` PRs may target `main`.
- Use `npm ci` and npm caching in CI and pin every third-party GitHub Action to an explicit reviewed commit SHA with its version comment.
- A failed quality check or Semantic Release run must block delivery. A missing `VSCE_PAT` only skips Marketplace publication after a GitHub release has succeeded.
- The published VSIX may contain only its manifest, `dist/`, `resources/`, `README.md`, `CHANGELOG.md`, and `LICENSE`; source, tooling, docs, GitHub metadata, and local-agent files must not ship.
- Ignore local agent configuration. Remove newly ignored tracked `.opencode/agents/*.md` entries from the index with `git rm --cached` without deleting their local copies.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `.nvmrc`, `package.json`, `package-lock.json` | Node 24 contract, tooling dependencies, and local commands. |
| `tsconfig.tools.json`, `esbuild.ts`, `esbuild.config.json` | Typecheck and build TypeScript-based tooling separately from extension sources. |
| `eslint.config.ts`, `.prettierrc.json`, `.prettierignore`, `.husky/commit-msg` | Lint, format, and commit-message standards. |
| `.gitignore`, `.vscodeignore` | Separate local-worktree hygiene from the explicit published-VSIX allowlist. |
| `scripts/test-release-config.mjs`, `scripts/test-package-config.mjs` | Executable assertions for delivery and VSIX policy. |
| `.github/workflows/*.yml` | PR, quality, and reusable release automation. |
| `.github/{CODEOWNERS,dependabot.yml,pull_request_template.md,ISSUE_TEMPLATE/*}` | Review ownership, dependency updates, and contributor intake. |

### Task 1: Establish executable delivery-policy tests

**Files:**
- Modify: `scripts/test-release-config.mjs`
- Create: `scripts/test-package-config.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: JSON package/release metadata and YAML workflow/governance files through `readFile` and `js-yaml`'s `load`.
- Produces: `npm run test:release` as the policy regression gate and `npm run test:package` as the VSIX content/size gate.

- [ ] **Step 1: Add failing package-policy assertions to `scripts/test-release-config.mjs`**

  Import `readFile`, `mkdtemp`, `rm`, `writeFile`, `tmpdir`, `join`, and `js-yaml`'s `load` alongside the existing Semantic Release imports. Read `package.json`, `package-lock.json`, `.nvmrc`, every workflow, Dependabot, CODEOWNERS, PR template, and both issue forms. Add exact assertions for:

  ```js
  assert.equal(packageJson.engines.node, '>=24 <25');
  assert.equal(packageJson.engines.vscode, '^1.125.0');
  assert.equal(nvmrc, '24');
  assert.equal(packageJson.scripts['check-types'], 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.tools.json --noEmit');
  assert.equal(packageJson.scripts['test:package'], 'node scripts/test-package-config.mjs');
  assert.equal(ciWorkflow.jobs.release.needs, 'quality');
  assert.deepEqual(ciWorkflow.jobs.quality.needs, ['commitlint', 'lint', 'test', 'test-release', 'build']);
  ```

  Assert pinned `checkout`, `setup-node`, and dependency-review action references; Node 24 in every setup step; no `continue-on-error` in the semantic-release step; and conditional Marketplace publication based on both `published` and `marketplace.available`.

- [ ] **Step 2: Run the policy test to prove the baseline is not yet adopted**

  Run: `rtk npm run test:release`

  Expected: FAIL because `.nvmrc`, tooling scripts, governance files, quality aggregation, and the VSIX contract do not yet exist.

- [ ] **Step 3: Add a failing VSIX contract test**

  Create `scripts/test-package-config.mjs` using `spawnSync('npx', ['vsce', 'package', '--no-dependencies', '--out', archive])`, `unzip -Z1`, and a temporary directory. Require these archive entries (case-insensitively): `package.json`, `dist/`, `resources/`, `README.md`, `CHANGELOG.md`, and `LICENSE`; allow only these plus VSIX metadata; reject `src/`, `.github/`, `.codex/`, `.husky/`, `docs/`, `scripts/`, `node_modules/`, `package-lock.json`, `tsconfig.json`, `esbuild.*`, `commitlint.config.js`, `.releaserc.json`, `.nvmrc`, and `.gitignore`. Enforce a 2 MiB maximum.

  ```js
  assert.ok((await stat(archive)).size < 2 * 1024 * 1024, 'VSIX exceeds 2 MiB budget');
  for (const path of paths) {
    assert.ok(allowed.has(path) || allowedPrefixes.some((prefix) => path.startsWith(prefix)), `Unexpected package path: ${path}`);
  }
  ```

- [ ] **Step 4: Run the new contract test to prove it fails before the allowlist is fixed**

  Run: `rtk npm run test:package`

  Expected: FAIL because the current `.vscodeignore` is not an explicit ModBear allowlist.

- [ ] **Step 5: Keep the policy tests uncommitted until their implementing tasks pass**

  These assertions intentionally span the runtime, package, CI/CD, and governance work. Do not create a red commit. Carry both test files into the responsible tasks below; Task 6 is the first point at which `npm run test:release` must be fully green.

### Task 2: Upgrade runtime and build-tooling foundations

**Files:**
- Create: `.nvmrc`
- Create: `tsconfig.tools.json`
- Create: `esbuild.ts`
- Create: `esbuild.config.json`
- Delete: `esbuild.mjs`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: the policy assertions from Task 1 and extension entry point `src/extension.ts`.
- Produces: `check-types`, `bundle`, `bundle:prod`, and `bundle:analyze` commands suitable for Node 24 and CI.

- [ ] **Step 1: Set the runtime and compiler contracts**

  Add `.nvmrc` containing `24`. In `package.json`, set `engines` to:

  ```json
  "engines": { "vscode": "^1.125.0", "node": ">=24 <25" }
  ```

  Retain the strict `tsconfig.json` settings and add `"noImplicitOverride": true` plus `"forceConsistentCasingInFileNames": true`. Create `tsconfig.tools.json` extending it with `module: "ESNext"`, `moduleResolution: "Bundler"`, `noEmit: true`, `resolveJsonModule: true`, `rootDir: "."`, `types: ["node"]`, and include only `esbuild.ts` and `eslint.config.ts`.

- [ ] **Step 2: Replace the JavaScript build script with typed build configuration**

  Create `esbuild.config.json` with `src/extension.ts` as its sole entry point, `dist/extension.js` as output, external `vscode`, CommonJS/node platform, `target: "node22"`, UTF-8 charset, tree shaking, and `tsconfig: "tsconfig.json"`. Create `esbuild.ts` that imports that JSON, parses `--production`, `--watch`, and `--analyze`, rejects unknown or incompatible flags, then calls `build` or `context().watch()` with production minification and appropriate sourcemaps. Delete `esbuild.mjs`.

- [ ] **Step 3: Add the required development dependencies and scripts**

  Install exact baseline ranges compatible with the approved design:

  ```bash
  npm install --save-dev @eslint/js@^10.0.0 eslint@^10.7.0 husky@^9.1.7 jiti@^2.7.0 prettier@3.9.6 typescript-eslint@^8.65.0
  npm install --save-dev @types/node@^22.20.1 @types/vscode@^1.125.0
  ```

  Define `check-types` as the two-project TypeScript command, `bundle` as `jiti esbuild.ts`, plus `bundle:prod` and `bundle:analyze` variants. Keep existing test runners and make their compilation prerequisite explicit rather than changing their framework.

- [ ] **Step 4: Run the type and policy checks**

  Run: `rtk npm run check-types && rtk npm run test:release`

  Expected: Type checking and the runtime/build-script assertions PASS; policy assertions that concern later tasks may still FAIL.

- [ ] **Step 5: Commit the runtime and build foundation**

  ```bash
  git add .nvmrc tsconfig.json tsconfig.tools.json esbuild.ts esbuild.config.json esbuild.mjs package.json package-lock.json
  git commit -m "build: adopt node 24 tooling baseline"
  ```

### Task 3: Add formatting, linting, and commit-message enforcement

**Files:**
- Create: `eslint.config.ts`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.husky/commit-msg`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: TypeScript, JSON, Markdown, YAML, and JavaScript files changed by formatter output

**Interfaces:**
- Consumes: `tsconfig.json`, `tsconfig.tools.json`, the dev dependencies from Task 2, and Commitlint's existing `commitlint.config.js`.
- Produces: `format`, `format:check`, `lint`, `lint:fix`, and a `prepare` hook; production source has no unrestricted `console` calls.

- [ ] **Step 1: Add the flat, type-aware ESLint configuration**

  Configure `eslint.config.ts` with `@eslint/js` recommended rules and `typescript-eslint` strict plus stylistic type-checked configs for `src/**/*.ts`, `esbuild.ts`, and `eslint.config.ts`. Ignore generated directories and VSIX artifacts. Require type-only imports/exports, reject unused values except `_`-prefixed values, and enable `no-console` for production code while disabling it for `src/test/**` and tooling files. Set `parserOptions.project` to both tsconfig files and `tsconfigRootDir: import.meta.dirname`.

- [ ] **Step 2: Add deterministic Prettier policy and scripts**

  Create `.prettierrc.json` with LF endings, 2-space indentation, 120-column width, trailing commas, semicolons, double quotes, and preserved prose wrapping. Create `.prettierignore` for generated outputs, dependencies, VSIX/test artifacts, package lockfile, binary resources, and local agent/tooling directories. Add these scripts:

  ```json
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "lint": "eslint . --max-warnings 0",
  "lint:fix": "eslint . --fix --max-warnings 0",
  "prepare": "husky",
  "verify": "npm run format:check && npm run lint && npm run check-types && npm run compile && npm run test:unit:run && npm run test:integration:run"
  ```

  Keep `test:extension` separate so local `verify` is deterministic and does not require an Electron display; compile once before the `:run` suites so tests cannot consume stale output. CI remains responsible for the headless Extension Host check.

- [ ] **Step 3: Add the Commitlint hook and make mechanical fixes**

  Create `.husky/commit-msg` with `npx --no -- commitlint --edit ${1}`. Run lint auto-fixes and Prettier; resolve every remaining error without changing extension behavior. Use `import type` where the lint rule requires it and preserve all public names and runtime logic.

- [ ] **Step 4: Verify developer quality commands**

  Run: `rtk npm run format:check && rtk npm run lint && rtk npm run check-types && rtk npm run verify`

  Expected: PASS with zero ESLint warnings and no formatter changes required after the first formatting pass.

- [ ] **Step 5: Commit the standardization layer**

  Stage `eslint.config.ts`, `.prettierrc.json`, `.prettierignore`, `.husky/commit-msg`, `package.json`, `package-lock.json`, and only the formatter changes made in this task after reviewing their diff. Do not stage pre-existing user changes. Commit with `chore: standardize formatting and linting`.

### Task 4: Enforce worktree hygiene and the ModBear VSIX allowlist

**Files:**
- Modify: `.gitignore`
- Modify: `.vscodeignore`
- Modify: `scripts/test-package-config.mjs`
- Modify: `package.json`
- Remove from index only: `.opencode/agents/*.md`

**Interfaces:**
- Consumes: Task 1's archive contract and Task 3's local tool configuration.
- Produces: a clean checkout policy and a package that exposes only ModBear runtime and Marketplace assets.

- [ ] **Step 1: Expand `.gitignore` without ignoring checked-in project policy**

  Add coverage, `.nyc_output`, `*.tsbuildinfo`, logs, `.env*` with example-file exceptions, keys, temp/cache directories, IDE metadata, and local agent/MCP folders. Ignore `.claude/`, `.codex/`, `.gemini/`, `.opencode/`, `.serena/`, `.superpowers/`, `.agentmemory/`, `.mcp/`, `.mcp.json`, `.agents`, and the equivalent local helper files. Do not ignore `.github/`, repository docs, or the newly tracked tooling configs.

- [ ] **Step 2: Replace `.vscodeignore` with deny-by-default rules**

  Start with `**/*`, then unignore exactly:

  ```gitignore
  !package.json
  !dist/
  !dist/**
  !resources/
  !resources/**
  !README.md
  !CHANGELOG.md
  !LICENSE
  ```

  This is ModBear-specific: do not carry BufBear's language grammar/configuration assets into this allowlist.

- [ ] **Step 3: Remove only tracked local agent files from Git's index**

  Run: `git rm --cached .opencode/agents/*.md`

  Expected: Git stages deletion while the eight local files remain on disk. Confirm with `test -f` for each path and `git ls-files .opencode/agents` returning no entries.

- [ ] **Step 4: Test ignore and packaging contracts**

  Run: `rtk git check-ignore -q .codex/config.toml && rtk npm run package:vsix && rtk npm run test:package`

  Expected: local configuration is ignored, a VSIX is generated, and its content/size contract PASSes.

- [ ] **Step 5: Commit package hygiene**

  ```bash
  git add .gitignore .vscodeignore scripts/test-package-config.mjs package.json
  git rm --cached .opencode/agents/*.md
  git commit -m "build: enforce VSIX package contract"
  ```

### Task 5: Harden CI and the reusable release workflow

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/pr-title.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/test-release-config.mjs`

**Interfaces:**
- Consumes: `format:check`, `lint`, `check-types`, all existing test commands, `test:release`, `package:vsix`, and `test:package`.
- Produces: a `quality` aggregation job that alone gates the reusable release call.

- [ ] **Step 1: Pin CI actions and remove registry-dependent audit**

  Use these reviewed action references everywhere applicable:

  ```yaml
  actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v4.2.2
  actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v4.4.0
  actions/dependency-review-action@3b139cfc5fae8b618d3eae3675e383bb1769c019 # v4.5.0
  ```

  Set Node to 24 with npm cache in all relevant jobs. The dependency-review job retains GitHub Dependency Review for pull requests but removes Node setup, `npm ci`, and `npm audit`.

- [ ] **Step 2: Make quality checks explicit in `ci.yml`**

  The lint job runs `npm run format:check`, `npm run lint`, and `npm run check-types`. The test job runs existing unit and integration commands plus `xvfb-run -a npm run test:extension`. The build job runs `npm run package:vsix` then `npm run test:package`. Keep `test:release` as a separate job. Add:

  ```yaml
  quality:
    needs: [commitlint, lint, test, test-release, build]
    if: always() && needs.commitlint.result == 'success' && needs.lint.result == 'success' && needs.test.result == 'success' && needs.test-release.result == 'success' && needs.build.result == 'success'
  release:
    needs: quality
  ```

  Preserve the existing branch-trigger and `dev`/`development`-to-`main` policy.

- [ ] **Step 3: Harden PR-title and release behavior**

  Give `pr-title.yml` least-privilege read permissions, concurrency keyed by PR number, Node 24/npm cache, and safe `printf '%s\\n' "$PR_TITLE" | npx --no -- commitlint` input. In `release.yml`, use only `contents: write`, remove semantic-release `continue-on-error`, retain tag snapshot/resolution, and add a Marketplace availability step writing `available=true|false` to `$GITHUB_OUTPUT`. Publish only when both release output and the credential flag are true; otherwise log an explicit skip.

- [ ] **Step 4: Extend and run workflow policy tests**

  Assert workflow permissions, action SHAs, Node 24, absence of Docker/audit/`continue-on-error`, all quality dependencies, `release.needs === 'quality'`, VSIX contract invocation, and the Marketplace condition. Then run:

  Run: `rtk npm run test:release`

  Expected: PASS.

- [ ] **Step 5: Commit CI/CD hardening**

  ```bash
  git add .github/workflows scripts/test-release-config.mjs
  git commit -m "ci: harden quality and release gates"
  ```

### Task 6: Add GitHub governance assets

**Files:**
- Create: `.github/CODEOWNERS`
- Create: `.github/dependabot.yml`
- Create: `.github/pull_request_template.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `scripts/test-release-config.mjs`

**Interfaces:**
- Consumes: the package commands and current Go/govulncheck extension terminology.
- Produces: owner assignment, structured contributor intake, private security routing, and weekly dependency maintenance targeting `dev`.

- [ ] **Step 1: Add ownership and Dependabot configuration**

  Make `.github/CODEOWNERS` exactly assign `*` and `.github/` to `@diaszano`. Configure npm and GitHub Actions updates weekly on Monday at `09:00`, `America/Sao_Paulo`, targeting `dev`; group minor/patch updates; use prefixes `fix(deps)` and `chore(ci)`; allow five npm and three Actions PRs respectively.

- [ ] **Step 2: Create ModBear-specific PR and issue templates**

  The PR checklist must require Conventional Commits, `lint`, typecheck, unit/integration/Extension Host checks, release configuration, VSIX contract, and documentation review. The bug form requires VS Code version, OS, Go version/path, `govulncheck` version/path, ModBear version, reproduction, expected, and actual behavior. The feature form requires problem/use case and proposed solution. Disable blank issues and point the security link to `https://github.com/Diaszano/modbear/security/advisories/new`.

- [ ] **Step 3: Add governance assertions and execute them**

  In `test-release-config.mjs`, assert both Dependabot entries and schedule values, both CODEOWNERS lines, every required template checklist term, required YAML field IDs, disabled blank issues, and the ModBear private-advisory URL. Run:

  Run: `rtk npm run test:release`

  Expected: PASS.

- [ ] **Step 4: Commit governance policy**

  ```bash
  git add .github scripts/test-release-config.mjs
  git commit -m "chore: add repository governance"
  ```

### Task 7: Perform complete delivery verification

**Files:**
- Modify only if a check exposes a mechanical configuration/formatting defect: files owned by Tasks 2-6

**Interfaces:**
- Consumes: the completed local toolchain, package contract, workflow policy, and governance configuration.
- Produces: a verified implementation with no behavior changes to ModBear.

- [ ] **Step 1: Install from the committed lockfile under Node 24**

  Run: `rtk npm ci`

  Expected: PASS without lockfile changes.

- [ ] **Step 2: Execute every local quality gate**

  Run: `rtk npm run format:check && rtk npm run lint && rtk npm run check-types && rtk npm run test:unit && rtk npm run test:integration && rtk npm run test:extension && rtk npm run test:commits && rtk npm run test:release && rtk npm run package:vsix && rtk npm run test:package`

  Expected: Every command PASSes. If Extension Host needs a display, use the project-supported headless equivalent `xvfb-run -a npm run test:extension` and record that CI uses it.

- [ ] **Step 3: Verify static delivery invariants**

  Run: `rtk git check-ignore -q .codex/config.toml && rtk git ls-files .opencode/agents && rtk git diff --check`

  Expected: `.codex/config.toml` is ignored, no `.opencode/agents` file is tracked, and the diff has no whitespace errors.

- [ ] **Step 4: Route any correction to its owning task before committing**

  If a check exposes a defect, correct it in the task that owns its file and create that task's declared commit with only the corrected files. Do not create a catch-all verification commit, and do not stage unrelated worktree changes.

## Self-Review

- Spec coverage: Tasks 2-4 cover Node/VS Code baselines, tooling, formatting, local hooks, ignores, and VSIX constraints; Task 5 covers CI/CD and release behavior; Task 6 covers governance; Task 7 covers every required verification category.
- Scope: The plan intentionally leaves Go/govulncheck execution, extension behavior, test framework selection, and external Marketplace credentials unchanged.
- Ambiguity resolved: `verify` is a deterministic local unit/integration gate; the Extension Host suite remains an explicit CI and release-verification gate because it requires GUI infrastructure.
