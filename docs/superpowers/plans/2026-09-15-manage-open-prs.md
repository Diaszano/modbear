# Manage Open PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up, fix, and integrate all open Dependabot Pull Requests on Diaszano/modbear to bring repository dependencies and GitHub Actions workflows up to date with zero breaking regressions.

**Architecture:** Triage the 7 open PRs into 4 distinct phases:

1. Close obsolete and misconfigured PRs (#11, #12, #7, #10).
2. Fix pinned GitHub Actions commit hashes in `scripts/test-release-config.mjs` for PR #8 (`actions/checkout` v4.2.2) and merge into `dev`.
3. Fix pinned GitHub Actions commit hashes in `scripts/test-release-config.mjs` for PR #9 (`actions/dependency-review-action` v5.0.0) and merge into `dev`.
4. Align `@types/vscode` with `engines.vscode` (`^1.125.0`) in PR #16 (`minor-and-patch` npm updates), verify VSIX packaging contract, and merge into `dev`.

**Tech Stack:** GitHub CLI (`gh`), Git, Node.js 24, npm, VS Code Extension Packaging (`vsce`).

**Spec:** User request to triage, clean up, and merge open PRs following repository governance.

## Global Constraints

- All PRs merged or created must target `dev` (the default working branch in Diaszano/modbear), never `main`.
- All commits must adhere to Conventional Commits format (`fix:`, `chore:`, etc.).
- CI gates require 0 fixable HIGH/CRITICAL vulnerabilities and passing unit, integration, release, and packaging tests.
- `@types/vscode` must never exceed `engines.vscode` (`^1.125.0`) per VSCE packaging contract.

---

### Task 1: Close obsolete and misconfigured PRs (#11, #12, #7, #10)

**Files:**

- None (GitHub Pull Request state operations via `gh`)

**Interfaces:**

- Consumes: Open PR #11, PR #12, PR #7, PR #10
- Produces: Closed PRs with audit comments explaining rationale

- [x] **Step 1: Close PR #11 (obsolete `glob` package)**

```bash
gh pr close 11 --comment "Closing as obsolete: 'glob' was removed from dependencies in favor of Node 24 native node:fs/promises glob."
```

- [x] **Step 2: Close PR #12 (misdirected base `main`)**

```bash
gh pr close 12 --comment "Closing: PR targets 'main' branch directly instead of 'dev', contrary to repository contribution guidelines."
```

- [x] **Step 3: Close PR #7 (incompatible Node 26 types for Node 24 engine)**

```bash
gh pr close 7 --comment "Closing as incompatible: repository engine target is Node 24 (>=24 <25); @types/node 26.x is for Node 26."
```

- [x] **Step 4: Close PR #10 (deferred TypeScript 7 major bump)**

```bash
gh pr close 10 --comment "Closing for dedicated migration: TypeScript 7 is a major version bump that will be addressed in a planned upgrade."
```

- [x] **Step 5: Verify all 4 PRs are closed**

```bash
gh pr list --state closed --limit 4
```

---

### Task 2: Rebase PR #8, update pinned action hash in `scripts/test-release-config.mjs`, and merge

**Files:**

- Modify: `scripts/test-release-config.mjs:34`
- Modify: `.github/workflows/ci.yml`, `.github/workflows/pr-title.yml`, `.github/workflows/release.yml`

**Interfaces:**

- Consumes: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
- Produces: Passing release config assertions and merged PR #8

- [x] **Step 1: Checkout and rebase PR #8 onto `dev`**

```bash
gh pr checkout 8
git rebase dev
```

- [x] **Step 2: Update `actions/checkout` in `scripts/test-release-config.mjs`**

```javascript
const actionRefs = {
  "actions/checkout": "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  ...
};
```

- [x] **Step 3: Verify release tests pass and commit**

```bash
npm run test:release
git add scripts/test-release-config.mjs
git commit -m "chore(ci): update pinned action hashes in release config test"
git push origin HEAD --force-with-lease
```

- [x] **Step 4: Verify CI checks turn green and merge into `dev`**

```bash
gh pr checks 8 --watch
gh pr merge 8 --squash --delete-branch
git checkout dev && git pull origin dev
```

---

### Task 3: Rebase PR #9, update pinned action hash in `scripts/test-release-config.mjs`, and merge

**Files:**

- Modify: `scripts/test-release-config.mjs:36`
- Modify: `.github/workflows/ci.yml:25`

**Interfaces:**

- Consumes: `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294`
- Produces: Passing release config assertions and merged PR #9

- [x] **Step 1: Checkout and rebase PR #9 onto `dev`**

```bash
gh pr checkout 9
git rebase dev
```

- [x] **Step 2: Update `actions/dependency-review-action` in `scripts/test-release-config.mjs`**

```javascript
const actionRefs = {
  ...
  "actions/dependency-review-action": "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
};
```

- [x] **Step 3: Verify release tests pass and commit**

```bash
npm run test:release
git add scripts/test-release-config.mjs
git commit -m "chore(ci): update pinned action hashes in release config test"
git push origin HEAD --force-with-lease
```

- [x] **Step 4: Verify CI checks turn green and merge into `dev`**

```bash
gh pr checks 9 --watch
gh pr merge 9 --squash --delete-branch
git checkout dev && git pull origin dev
```

---

### Task 4: Rebase PR #16, enforce `@types/vscode` packaging contract, and merge

**Files:**

- Modify: `package.json:262`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: Dependabot minor/patch dependency upgrades
- Produces: Passing VSIX packaging check and merged PR #16

- [x] **Step 1: Checkout and rebase PR #16 onto `dev`**

```bash
gh pr checkout 16
git rebase dev
```

- [x] **Step 2: Align `@types/vscode` to `^1.125.0` to match `engines.vscode`**

Revert `@types/vscode` from `^1.137.0` back to `^1.125.0` in `package.json` and update `package-lock.json`.

- [x] **Step 3: Verify VSIX package contract**

```bash
npm run package:vsix
npm run test:package
npm run clean
```

- [x] **Step 4: Commit and push fix**

```bash
git add package.json package-lock.json
git commit -m "fix(deps): keep @types/vscode pinned to engines.vscode baseline"
git push origin HEAD --force-with-lease
```

- [x] **Step 5: Verify CI checks turn green and merge into `dev`**

```bash
gh pr checks 16 --watch
gh pr merge 16 --squash --delete-branch
git checkout dev && git pull origin dev
```

---

## Final Verification Checklist

- [x] `gh pr list --state open` returns 0 open pull requests
- [x] All 154 unit and 31 integration tests pass cleanly on `dev`
- [x] `npm run test:release` passes with all pinned action hashes verified
- [x] `npm run package:vsix` and `npm run test:package` pass with VSIX contract satisfied
- [x] `git status` clean on `dev` with working tree in sync with `origin/dev`
