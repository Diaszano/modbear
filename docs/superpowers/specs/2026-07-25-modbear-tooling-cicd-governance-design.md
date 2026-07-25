# ModBear tooling, CI/CD, and governance design

**Date:** 2026-07-25
**Status:** Approved

## Goal

Bring ModBear's development standards, CI/CD hardening, and GitHub governance in line with the proven BufBear model while retaining ModBear's Go-module domain, existing Node test runner, and Extension Host test suite.

## Scope

This work updates repository configuration and the mechanical source/configuration changes required for those checks to pass. It does not change ModBear's extension behavior, its Go or `govulncheck` integrations, or rewrite tests from the Node test runner to Mocha.

The platform baseline becomes Node 24 and VS Code `^1.125.0`.

## Local development standards

- Add `.nvmrc` for Node 24 and declare Node `>=24 <25` in `package.json`.
- Update the VS Code engine to `^1.125.0`.
- Keep strict TypeScript settings and add `tsconfig.tools.json` for TypeScript tooling files such as build and lint configuration.
- Add type-aware ESLint for TypeScript, JavaScript tooling, and tests. Rules will enforce consistent type imports/exports, catch unused values, and prohibit production `console` usage while allowing it in tooling and tests.
- Add Prettier as the formatting authority, with a checked-in configuration and ignore file.
- Provide explicit scripts for `format`, `format:check`, `lint`, `lint:fix`, `check-types`, and `verify`.
- Preserve the current `node --test` unit and integration commands plus the Extension Host test command. `verify` runs the local quality checks appropriate to the extension without migrating test frameworks.
- Add Husky's `commit-msg` hook to run Commitlint.

Formatting and lint autofixes may make mechanical changes to TypeScript and configuration files. They must not alter extension behavior.

## Ignore policy and tracked local files

Expand `.gitignore` for generated output, test artifacts, local secrets, editor metadata, temporary files, and local AI-agent configuration. The repository must not retain tracked files newly covered by those patterns.

Files removed from version control will use `git rm --cached` so the local copy remains. At design time, the affected tracked paths are the eight `.opencode/agents/*.md` files. Existing generated output, VSIX files, test installations, and worktrees are already ignored and untracked.

## CI/CD

The existing GitHub Actions topology remains: dependency review, commit validation, lint/type checking, tests, release configuration validation, VSIX packaging, and reusable release workflow.

- Use Node 24 consistently and pin third-party actions to reviewed commit SHAs with version comments.
- Keep npm caching and `npm ci` in relevant jobs.
- Remove `npm audit` from dependency review. GitHub Dependency Review on pull requests and Dependabot handle dependency policy without registry-dependent audit failures.
- Run the new lint and typecheck commands in CI.
- Keep all current ModBear unit, integration, and headless Extension Host tests.
- Add a `quality` aggregation job. The release workflow is callable only when every required job succeeds.
- Package the VSIX and validate its contents and a size budget with a ModBear-specific package contract test. Allowed artifacts reflect ModBear's extension assets; source code, internal configs, docs, tooling files, and local-agent configuration must not ship.
- Retain Semantic Release and the stable-tag resolver. A Semantic Release failure fails the workflow. Marketplace publishing runs only when a release was published and `VSCE_PAT` is present; without that secret, the workflow reports a skipped publish while retaining the GitHub release and VSIX asset.
- Narrow release workflow permissions to the permissions actually needed.

Tests that assert release configuration must be updated in lockstep with this workflow so policy drift fails locally and in CI.

## GitHub governance

Add the following project-specific files:

- `CODEOWNERS` assigning repository and workflow ownership to `@diaszano`.
- Pull request template with conventional-commit, quality-gate, package, and documentation checks that match ModBear's commands.
- Bug and feature request issue forms tailored to Go modules, Go toolchain, `govulncheck`, VS Code, and reproduction details.
- Issue-template configuration that routes security reports to ModBear's private GitHub Security Advisory flow.
- Dependabot configuration for weekly npm and GitHub Actions updates targeting `dev`, grouping minor and patch updates and limiting open pull requests.

## Failure behavior

Any failure in commit validation, format/lint/type checks, tests, release configuration, package creation, or the package contract prevents the quality aggregate from succeeding and therefore prevents release execution. A missing Marketplace credential is the only non-fatal publication condition: it skips Marketplace publication after a successful GitHub release.

## Verification

Implementation is accepted when, under Node 24, the following succeed:

1. Dependency installation with the committed lockfile.
2. Formatting check, ESLint, and TypeScript checks.
3. Existing unit, integration, and Extension Host tests.
4. Commit validation and release configuration tests.
5. VSIX generation and the ModBear package contract test.
6. Static inspection that all added ignore rules have no tracked matches and that CI/release workflows reference the new scripts and pinned actions.

## Delivery sequence

1. Introduce runtimes, tooling dependencies, configs, scripts, formatting, and ignore policy.
2. Remove newly ignored tracked local-agent files from the Git index while preserving local copies.
3. Adapt release/package tests and GitHub workflows.
4. Add governance files.
5. Run the complete verification suite and resolve mechanical quality failures without functional changes.
