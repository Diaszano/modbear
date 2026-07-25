# Changelog

All notable changes to the ModBear extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-21

### Added

- Read-only Go module dependency scanning via `go list -u -m -json all`.
- Inline inlay hints in `go.mod` files showing available version updates (patch, minor, major).
- Deprecation and retraction detection with VS Code diagnostics.
- Hover details provider showing dependency version information, deprecation notices, retraction rationales, and suggested copyable update commands.
- Workspace Trust enforcement: subprocess execution is disabled in untrusted workspaces.
- Disk and memory caching of analysis snapshots with configurable TTL (`modBear.scan.updateTtlMinutes`).
- Subprocess concurrency limiters and execution timeouts for scanner tasks.
- Sensitive data redaction in log output channels (passwords, tokens, home directory paths).
